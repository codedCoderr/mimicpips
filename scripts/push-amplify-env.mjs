import { AmplifyClient, UpdateAppCommand, GetAppCommand } from "@aws-sdk/client-amplify";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";

// 1. Load local env file
const envPath = path.resolve(process.cwd(), ".env.local");
if (!fs.existsSync(envPath)) {
  console.error("No .env file found!");
  process.exit(1);
}

const localEnv = dotenv.parse(fs.readFileSync(envPath));

// 2. Configure AWS Amplify Client
// Set your App ID (found in Amplify Console URL) and AWS Region
const appId = process.env.AMPLIFY_APP_ID || "deij11a7rlme0"; 
const region = process.env._REGION || "eu-north-1"; 

const client = new AmplifyClient({ region });

async function syncEnv() {
  try {
    console.log(`Fetching current Amplify config for app: ${appId}...`);
    const { app } = await client.send(new GetAppCommand({ appId }));

    const existingEnv = app.environmentVariables || {};
    const mergedEnv = { ...existingEnv, ...localEnv };

    console.log("Updating Amplify environment variables with local .env keys...");
    await client.send(
      new UpdateAppCommand({
        appId,
        environmentVariables: mergedEnv,
      })
    );

    console.log("✅ Successfully updated Amplify environment variables!");
  } catch (error) {
    console.error("❌ Failed to push env variables:", error);
  }
}

syncEnv();