import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
  RespondToAuthChallengeCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { CognitoJwtVerifier } from "aws-jwt-verify";

// Email + password sign-in backed by an Amazon Cognito user pool.
// The browser never sees tokens: they live in httpOnly cookies set by this server.
const POOL_ID = process.env.COGNITO_USER_POOL_ID;
const CLIENT_ID = process.env.COGNITO_CLIENT_ID;
const REGION = process.env.AWS_REGION || "us-east-1";
const PRODUCTION = process.env.NODE_ENV === "production";

export const authEnabled = Boolean(POOL_ID && CLIENT_ID);
if (!authEnabled && PRODUCTION) {
  throw new Error("COGNITO_USER_POOL_ID and COGNITO_CLIENT_ID must be set in production.");
}

const cognito = authEnabled ? new CognitoIdentityProviderClient({ region: REGION }) : null;
const verifier = authEnabled ? CognitoJwtVerifier.create({ userPoolId: POOL_ID, clientId: CLIENT_ID, tokenUse: "access" }) : null;

const ACCESS_COOKIE = "session";
const REFRESH_COOKIE = "refresh";
const REFRESH_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // matches the app client's refresh token validity
const cookieOptions = { httpOnly: true, secure: PRODUCTION, sameSite: "lax", path: "/" };

// Paths anyone can reach without signing in.
const PUBLIC_PATHS = new Set(["/login", "/auth/login", "/auth/new-password", "/auth/logout", "/healthz"]);

function setSessionCookies(res, result) {
  res.cookie(ACCESS_COOKIE, result.AccessToken, { ...cookieOptions, maxAge: result.ExpiresIn * 1000 });
  if (result.RefreshToken) {
    res.cookie(REFRESH_COOKIE, result.RefreshToken, { ...cookieOptions, maxAge: REFRESH_MAX_AGE });
  }
}

function clearSessionCookies(res) {
  res.clearCookie(ACCESS_COOKIE, cookieOptions);
  res.clearCookie(REFRESH_COOKIE, cookieOptions);
}

// Returns the verified access-token payload, refreshing it if it has expired, or null.
async function currentUser(req, res) {
  const token = req.cookies?.[ACCESS_COOKIE];
  if (token) {
    try {
      return await verifier.verify(token);
    } catch {
      // expired or invalid - try the refresh token below
    }
  }
  const refreshToken = req.cookies?.[REFRESH_COOKIE];
  if (!refreshToken) return null;
  try {
    const out = await cognito.send(
      new InitiateAuthCommand({
        AuthFlow: "REFRESH_TOKEN_AUTH",
        ClientId: CLIENT_ID,
        AuthParameters: { REFRESH_TOKEN: refreshToken },
      })
    );
    setSessionCookies(res, out.AuthenticationResult);
    return await verifier.verify(out.AuthenticationResult.AccessToken);
  } catch {
    clearSessionCookies(res);
    return null;
  }
}

// Middleware: let signed-in users through; send everyone else to the sign-in page.
export async function requireAuth(req, res, next) {
  if (!authEnabled || PUBLIC_PATHS.has(req.path)) return next();
  const user = await currentUser(req, res);
  if (user) {
    req.user = user;
    return next();
  }
  if (req.path.startsWith("/api/")) return res.status(401).json({ error: "Please sign in again." });
  res.redirect("/login");
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function page({ error = "", email = "", session = "" } = {}) {
  const newPassword = Boolean(session);
  const fields = newPassword
    ? `<p class="note">Choose a new password to finish setting up your account.</p>
       <input type="hidden" name="email" value="${escapeHtml(email)}">
       <input type="hidden" name="session" value="${escapeHtml(session)}">
       <label>New password<input type="password" name="password" autocomplete="new-password" required autofocus></label>`
    : `<label>Email<input type="email" name="email" value="${escapeHtml(email)}" autocomplete="username" required autofocus></label>
       <label>Password<input type="password" name="password" autocomplete="current-password" required></label>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign in</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: system-ui, sans-serif; display: grid; place-items: center; min-height: 100vh; margin: 0; padding: 16px; box-sizing: border-box; }
  form { width: 100%; max-width: 340px; display: grid; gap: 14px; }
  h1 { margin: 0 0 4px; font-size: 1.5rem; }
  label { display: grid; gap: 6px; font-size: 0.9rem; }
  input { font: inherit; padding: 10px; border: 1px solid #8886; border-radius: 8px; }
  button { font: inherit; padding: 10px; border: 0; border-radius: 8px; background: #2563eb; color: #fff; cursor: pointer; }
  .error { color: #dc2626; margin: 0; }
  .note { margin: 0; opacity: 0.8; }
</style>
</head>
<body>
<form method="post" action="${newPassword ? "/auth/new-password" : "/auth/login"}">
  <h1>Sign in</h1>
  ${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}
  ${fields}
  <button type="submit">${newPassword ? "Set password" : "Sign in"}</button>
</form>
</body>
</html>`;
}

function loginError(err) {
  const name = err?.name;
  if (name === "NotAuthorizedException" || name === "UserNotFoundException") return "Incorrect email or password.";
  if (name === "InvalidPasswordException") return err.message;
  if (name === "PasswordResetRequiredException") return "Your password must be reset. Ask the administrator.";
  if (name === "TooManyRequestsException" || name === "LimitExceededException") return "Too many attempts. Wait a few minutes and try again.";
  return "Sign-in failed. Please try again.";
}

// Handle a Cognito auth response: either signed in, or a new password is required.
function finishAuth(res, out, email) {
  if (out.AuthenticationResult) {
    setSessionCookies(res, out.AuthenticationResult);
    return res.redirect("/");
  }
  if (out.ChallengeName === "NEW_PASSWORD_REQUIRED") {
    return res.send(page({ email, session: out.Session }));
  }
  res.status(400).send(page({ email, error: "This account needs a sign-in step the app doesn't support." }));
}

export function registerAuthRoutes(app) {
  app.get("/login", (req, res) => {
    if (!authEnabled) return res.redirect("/");
    res.send(page());
  });

  app.post("/auth/login", async (req, res) => {
    const email = String(req.body?.email || "").trim();
    const password = String(req.body?.password || "");
    try {
      const out = await cognito.send(
        new InitiateAuthCommand({
          AuthFlow: "USER_PASSWORD_AUTH",
          ClientId: CLIENT_ID,
          AuthParameters: { USERNAME: email, PASSWORD: password },
        })
      );
      finishAuth(res, out, email);
    } catch (err) {
      res.status(401).send(page({ email, error: loginError(err) }));
    }
  });

  app.post("/auth/new-password", async (req, res) => {
    const email = String(req.body?.email || "").trim();
    const session = String(req.body?.session || "");
    try {
      const out = await cognito.send(
        new RespondToAuthChallengeCommand({
          ChallengeName: "NEW_PASSWORD_REQUIRED",
          ClientId: CLIENT_ID,
          Session: session,
          ChallengeResponses: { USERNAME: email, NEW_PASSWORD: String(req.body?.password || "") },
        })
      );
      finishAuth(res, out, email);
    } catch (err) {
      // An invalid password keeps the challenge open; anything else starts over.
      const retry = err?.name === "InvalidPasswordException";
      res.status(400).send(page({ email, session: retry ? session : "", error: loginError(err) }));
    }
  });

  app.post("/auth/logout", (req, res) => {
    clearSessionCookies(res);
    res.redirect("/login");
  });
}
