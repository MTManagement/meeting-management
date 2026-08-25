const express = require("express");
const crypto = require("crypto");
const { exec, spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const app = express();
const jsonParser = express.json();

const PORT = process.env.PORT || 3102;
const CONTROL_PASSWORD = process.env.CONTROL_PASSWORD;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
const APP_CONTAINER = process.env.APP_CONTAINER || "mtmanagement-server";
const DEPLOY_BRANCH = process.env.BRANCH || "main";
const DEPLOY_SCRIPT = path.join(__dirname, "deploy.sh");
const LOG_FILE = "/tmp/mtmanagement-deploy.log";

if (!CONTROL_PASSWORD) {
  console.error("CONTROL_PASSWORD 환경변수가 설정되지 않았습니다.");
  process.exit(1);
}
if (!WEBHOOK_SECRET) {
  console.warn("WEBHOOK_SECRET이 설정되지 않았습니다. 웹훅 배포가 항상 거부됩니다.");
}

// ---- 인증: 비밀번호 로그인 -> 메모리 토큰 발급 ----
const tokens = new Map(); // token -> expiresAt
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // 12시간

function issueToken() {
  const token = crypto.randomBytes(24).toString("hex");
  tokens.set(token, Date.now() + TOKEN_TTL_MS);
  return token;
}

function requireAuth(req, res, next) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  const expiresAt = token && tokens.get(token);
  if (!expiresAt || expiresAt < Date.now()) {
    return res.status(401).json({ error: "인증이 필요합니다." });
  }
  next();
}

setInterval(() => {
  const now = Date.now();
  for (const [t, exp] of tokens) if (exp < now) tokens.delete(t);
}, 60 * 60 * 1000);

app.use(express.static(path.join(__dirname, "public")));

app.post("/auth", jsonParser, (req, res) => {
  const { password } = req.body || {};
  if (password !== CONTROL_PASSWORD) {
    return res.status(401).json({ error: "비밀번호가 올바르지 않습니다." });
  }
  res.json({ token: issueToken() });
});

// ---- 컨테이너 제어 ----
function runDocker(args, res) {
  exec(`docker ${args}`, { timeout: 30000 }, (err, stdout, stderr) => {
    if (err) return res.status(500).json({ error: stderr || err.message });
    res.json({ ok: true, output: stdout });
  });
}

app.post("/api/start", requireAuth, (req, res) =>
  runDocker(`start ${APP_CONTAINER}`, res)
);
app.post("/api/stop", requireAuth, (req, res) =>
  runDocker(`stop ${APP_CONTAINER}`, res)
);
app.post("/api/kill", requireAuth, (req, res) =>
  runDocker(`kill ${APP_CONTAINER}`, res)
);
app.post("/api/restart", requireAuth, (req, res) =>
  runDocker(`restart ${APP_CONTAINER}`, res)
);

app.get("/api/status", requireAuth, (req, res) => {
  exec(
    `docker inspect --format "{{.State.Status}}" ${APP_CONTAINER}`,
    (err, stdout) => {
      if (err) return res.json({ status: "not_found" });
      res.json({ status: stdout.trim() });
    }
  );
});

// ---- 수동/웹훅 빌드 (deploy.sh 실행) ----
let building = false;

function runDeploy(source) {
  if (building) return false;
  building = true;
  fs.writeFileSync(
    LOG_FILE,
    `=== ${source} 배포 시작 ${new Date().toISOString()} ===\n`
  );
  const child = spawn("bash", [DEPLOY_SCRIPT], { env: process.env });
  child.stdout.on("data", (d) => fs.appendFileSync(LOG_FILE, d));
  child.stderr.on("data", (d) => fs.appendFileSync(LOG_FILE, d));
  child.on("close", (code) => {
    fs.appendFileSync(LOG_FILE, `\n=== 종료 코드 ${code} ===\n`);
    building = false;
  });
  return true;
}

app.post("/api/build", requireAuth, (req, res) => {
  const started = runDeploy("수동 빌드");
  if (!started) {
    return res.status(409).json({ error: "이미 빌드가 진행 중입니다." });
  }
  res.status(202).json({ ok: true });
});

app.get("/api/logs", requireAuth, (req, res) => {
  if (!fs.existsSync(LOG_FILE)) return res.json({ log: "", building });
  const lines = fs.readFileSync(LOG_FILE, "utf8").split("\n").slice(-200);
  res.json({ log: lines.join("\n"), building });
});

// ---- GitHub 웹훅 (x-hub-signature-256, "sha256=" 접두어) ----
app.post(
  "/webhook/github",
  express.raw({ type: "application/json" }),
  (req, res) => {
    const signature = req.headers["x-hub-signature-256"];
    if (!signature || !WEBHOOK_SECRET) {
      return res.status(401).send("signature missing");
    }

    const expected =
      "sha256=" +
      crypto
        .createHmac("sha256", WEBHOOK_SECRET)
        .update(req.body)
        .digest("hex");

    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expected);
    const valid =
      sigBuf.length === expBuf.length &&
      crypto.timingSafeEqual(sigBuf, expBuf);

    if (!valid) {
      return res.status(401).send("invalid signature");
    }

    let payload;
    try {
      payload = JSON.parse(req.body.toString("utf8"));
    } catch {
      return res.status(400).send("invalid payload");
    }

    // ping 이벤트 등 ref가 없는 경우는 그냥 확인만
    const ref = payload.ref;
    if (ref && ref !== `refs/heads/${DEPLOY_BRANCH}`) {
      return res.status(200).send(`ignored ref ${ref}`);
    }
    if (!ref) {
      return res.status(200).send("ok (no ref, e.g. ping event)");
    }

    const started = runDeploy("GitHub 웹훅");
    res
      .status(202)
      .send(started ? "deploy started" : "deploy already running");
  }
);

// ---- Gitea 웹훅 (주 저장소) ----
// 시크릿 검증은 아직 미적용 - X-Gitea-Signature가 붙으면 추후 추가 예정.
// push 이벤트 + 대상 브랜치가 일치할 때만 deploy.sh를 실행한다.
app.post("/webhook/gitea", jsonParser, (req, res) => {
  const event = req.headers["x-gitea-event"];
  if (event && event !== "push") {
    return res.status(200).send(`ignored event ${event}`);
  }

  const ref = req.body?.ref;
  if (ref && ref !== `refs/heads/${DEPLOY_BRANCH}`) {
    return res.status(200).send(`ignored ref ${ref}`);
  }

  const started = runDeploy("Gitea 웹훅");
  res.status(202).send(started ? "deploy started" : "deploy already running");
});

app.listen(PORT, () => {
  console.log(`mtmanagement-control listening on :${PORT}`);
});
