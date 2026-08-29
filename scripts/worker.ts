// worker.ts
import dotenv from "dotenv";
dotenv.config( { path: ".env.local" } ); // 👈 Force loading from .env.local

import { initBillingCron } from "@/lib/cron/billingCron";
initBillingCron();