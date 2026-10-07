# Local Chat App

A chat app for working with documents. Attach files (PDF, Excel, Word, CSV, images, text),
type an instruction like "Total the Sales column" or "Summarize this PDF", and get the result.
Answers come from Claude Sonnet 5.5 on Amazon Bedrock. Users sign in with email and password (Amazon Cognito).

```
web/                      React front end (http://localhost:5173 in dev)
server/                   Express backend (http://localhost:3001); serves the built front end in production
Dockerfile                one container: builds web/, runs server/
infra/stack.yaml          CloudFormation: VPC, ECR, ECS Fargate, internal ALB, CloudFront, Cognito, GitHub OIDC role
.github/workflows/        GitHub Actions: build image -> push to ECR -> roll out on ECS
```

## Architecture

```
Browser --HTTPS--> CloudFront --VPC origin--> internal ALB --> ECS Fargate task (this container)
                                                                  |-- Cognito (sign-in)
                                                                  '-- Bedrock (Claude), via the task's IAM role
GitHub push to main --> Actions (OIDC role, no AWS keys) --> ECR --> ECS rolling deploy
```

The task role can only call `bedrock-mantle:CreateInference`. The ALB is internal, and the only way in is through CloudFront.

## Deploy to AWS (first time)

1. Deploy the stack. Start with `DesiredCount=0` because there's no image yet:
   ```
   aws cloudformation deploy --region us-east-1 --stack-name local-chat-app \
     --template-file infra/stack.yaml --capabilities CAPABILITY_NAMED_IAM \
     --parameter-overrides DesiredCount=0
   ```
   If your account already has the GitHub OIDC provider, add `CreateGitHubOIDCProvider=false`.
2. Put the `GitHubDeployRoleArn` output into `AWS_ROLE_ARN` in `.github/workflows/deploy.yml`, then push to `main`.
   The workflow builds and pushes the image.
3. Start the service:
   ```
   aws cloudformation deploy --region us-east-1 --stack-name local-chat-app \
     --template-file infra/stack.yaml --capabilities CAPABILITY_NAMED_IAM \
     --parameter-overrides DesiredCount=1
   ```
4. Create a user. Cognito emails them a temporary password, and they choose a new one at first sign-in:
   ```
   aws cognito-idp admin-create-user --region us-east-1 --user-pool-id <UserPoolId> \
     --username someone@example.com --user-attributes Name=email,Value=someone@example.com Name=email_verified,Value=true
   ```
5. Open the `AppUrl` output.

After that, every push to `main` deploys automatically.

Bedrock model access: Claude Sonnet 5.5 may need a one-time access request in
**Bedrock console > Model access** (us-east-1) before the first call works.

## Run locally

Requires Node.js 20+ and working AWS credentials (`aws configure` or `aws sso login`) with Bedrock access.

```
npm run install:all
cp server/.env.example server/.env
npm run dev
```

Then open http://localhost:5173. Sign-in is off locally unless you set `COGNITO_USER_POOL_ID` and
`COGNITO_CLIENT_ID` in `server/.env`. Set `AI_DISABLED=1` to get echo replies without calling Bedrock.

## Features

- **Instructions and results.** Each answer asks: *View this result online or download it?*
  - **View online** opens the result as a page in a new browser tab.
  - **Download** saves it as Excel (.xlsx, when the result has a table), a web page (.html), or text (.txt).
- **Recent files.** The button at the top lists every upload, newest first. You can view a file
  in the app, attach it to a new message, download it, or delete it.
- **Uploads.** Click 📎 or drag files onto the page. Supported: PDF, Excel (`.xlsx`, `.xls`,
  `.ods`), CSV, Word (`.docx`), text (`.txt`, `.md`, `.json`), and images (PNG, JPG, GIF, WebP).
  Limits: 10 MB per file, 5 files per message.

## How it works

- `server/index.js`: the API routes: chat, upload, and recent files (list, view, preview, delete).
- `server/auth.js`: the sign-in page, Cognito sign-in, and session cookies (httpOnly, refreshed automatically).
- `server/ai.js`: sends the conversation and attached files to Claude on Bedrock.
- `server/files.js`: saves uploads to `server/uploads/` and pulls text out of spreadsheets
  and Word files. PDFs and images are sent to Claude as-is.
- `web/src/`: the chat page (`App.jsx`), result buttons (`ResultActions.jsx`),
  Recent files panel (`RecentFiles.jsx`) and file viewer (`FileViewer.jsx`).

**Limitation:** in AWS, uploads are stored on the container's disk. They disappear on each deploy,
and all signed-in users share one Recent files list.
