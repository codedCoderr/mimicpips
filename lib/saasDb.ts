import dotenv from "dotenv";
// Load standard .env or fallback gracefully depending on your environment
dotenv.config();
dotenv.config( { path: ".env.local" } );

import { MongoClient, Db } from "mongodb";

/**
 * ─────────────────────────────────────────────────────────────────────────
 * SAAS & BOT DATABASE CONNECTIONS
 * Reuses a single MongoClient pool across both databases (`copytrade_saas` 
 * and `trading_bot`) on the same MongoDB cluster to optimize connections.
 * ─────────────────────────────────────────────────────────────────────────
 */

const uri = process.env.MONGO_URI || "mongodb://localhost:27017";

function resolveBotDbName (): string {
  if ( process.env.BOT_DB_NAME?.trim() ) return process.env.BOT_DB_NAME.trim();
  try {
    const parsed = new URL( uri );
    const pathDbName = decodeURIComponent( parsed.pathname.replace( /^\/+/, "" ) );
    return pathDbName || "trading_bot";
  } catch {
    return "trading_bot";
  }
}

const SAAS_DB_NAME = process.env.SAAS_DB_NAME || "copytrade_saas";
const BOT_DB_NAME = resolveBotDbName();

let client: MongoClient | null = null;
let saasDb: Db | null = null;
let botDb: Db | null = null;
let connecting: Promise<MongoClient> | null = null;
let indexesEnsured = false;
let ensuringIndexes: Promise<void> | null = null;

function sameKeyPattern (
  actual: Record<string, unknown> | undefined,
  expected: Record<string, number>
): boolean {
  if ( !actual ) return false;
  return JSON.stringify( actual ) === JSON.stringify( expected );
}

async function ensureCopyTradeLogIndexes ( database: Db ): Promise<void> {
  const collection = database.collection( "copy_trade_log" );
  const idempotencyKey = { userId: 1, leaderTradeId: 1, action: 1 };
  const indexes = await collection.indexes();
  const existingIdempotencyIndex = indexes.find( ( index ) => (
    sameKeyPattern( index.key, idempotencyKey ) && index.unique === true
  ) );

  await collection.createIndex( { userId: 1, createdAt: -1 } );

  if ( existingIdempotencyIndex ) return;

  await collection.createIndex(
    idempotencyKey,
    {
      unique: true,
      partialFilterExpression: {
        leaderTradeId: { $type: "string" },
        action: { $type: "string" },
      },
    }
  );
}

async function ensureIndexes ( database: Db ): Promise<void> {
  if ( indexesEnsured ) return;
  if ( ensuringIndexes ) return ensuringIndexes;

  ensuringIndexes = ( async () => {
    await Promise.all( [
      database.collection( "users" ).createIndex( { email: 1 }, { unique: true } ),
      database.collection( "exchange_keys" ).createIndex( { userId: 1 }, { unique: true } ),
      database.collection( "subscriptions" ).createIndex( { userId: 1 }, { unique: true } ),
      database.collection( "subscriptions" ).createIndex( { status: 1 } ),
      database.collection( "high_water_marks" ).createIndex( { userId: 1 }, { unique: true } ),
      database
        .collection( "performance_fee_invoices" )
        .createIndex( { userId: 1, createdAt: -1 } ),
      database
        .collection( "performance_fee_invoices" )
        .createIndex( { userId: 1, periodStart: 1 }, { unique: true } ),
      database
        .collection( "performance_fee_invoices" )
        .createIndex( { paystackReference: 1 }, { unique: true, sparse: true } ),
      database
        .collection( "performance_fee_invoices" )
        .createIndex( { status: 1 } ),
      ensureCopyTradeLogIndexes( database ),
      database.collection( "sessions" ).createIndex(
        { expiresAt: 1 },
        { expireAfterSeconds: 0 } // Mongo TTL index — auto-cleans expired sessions
      ),
      database.collection( "email_verification_tokens" ).createIndex( { token: 1 }, { unique: true } ),
      database
        .collection( "email_verification_tokens" )
        .createIndex( { expiresAt: 1 }, { expireAfterSeconds: 0 } ),
    ] );
    indexesEnsured = true;
    ensuringIndexes = null;
  } )().catch( ( error ) => {
    ensuringIndexes = null;
    throw error;
  } );

  return ensuringIndexes;
}

/** Establishes and returns the MongoClient connection promise */
async function getConnectedClient (): Promise<MongoClient> {
  if ( client ) return client;
  if ( connecting ) return connecting;

  connecting = ( async () => {
    try {
      const newClient = new MongoClient( uri, {
        connectTimeoutMS: 10000,
        socketTimeoutMS: 45000,
      } );
      await newClient.connect();
      client = newClient;
      return client;
    } catch ( err ) {
      connecting = null;
      throw err;
    }
  } )();

  return connecting;
}

/** Access the SaaS application database (copytrade_saas) */
export async function getSaasDb (): Promise<Db> {
  if ( saasDb ) return saasDb;

  const mongoClient = await getConnectedClient();
  saasDb = mongoClient.db( SAAS_DB_NAME );
  await ensureIndexes( saasDb );
  return saasDb;
}

/** Access the Bot application database (trading_bot / futures_history) */
export async function getBotDb (): Promise<Db> {
  if ( botDb ) return botDb;

  const mongoClient = await getConnectedClient();
  botDb = mongoClient.db( BOT_DB_NAME );
  return botDb;
}

/** Gracefully close database connection pools */
export async function closeSaasDb (): Promise<void> {
  if ( client ) {
    await client.close();
    client = null;
    saasDb = null;
    botDb = null;
    connecting = null;
    indexesEnsured = false;
  }
}
