import { getBotDb } from "@/lib/saasDb"; // Adjust paths as needed for your project structure
// If you have a separate client/helper for your main SaaS DB, import it here. 
// Otherwise, we can use MongoClient directly with your SaaS URI for the SaaS DB instance.
import { MongoClient } from "mongodb";
import * as dotenv from "dotenv";

dotenv.config( { path: ".env.local" } );

async function logUserCopyTrade () {
  try {
    const targetEmail = "codedcoderrr+coded@gmail.com";
    console.log( `🔍 Finding target SaaS user for: ${ targetEmail }` );

    // 1. Connect to Main SaaS DB (where users, subscriptions, and SaaS records live)
    const saasClient = new MongoClient( process.env.MONGO_URI || "mongodb://localhost:27017" );
    console.log( { saasClient } );
    await saasClient.connect();
    // Replace with your actual SaaS DB name if it's explicitly named in your URI or env
    const saasDb = saasClient.db();
    const usersCollection = saasDb.collection( "users" ); // or whatever your user collection is named
    const copyLogsCollection = saasDb.collection( "copy_trade_log" );

    // Find the user by email
    const user = await usersCollection.findOne( { email: targetEmail } );
    if ( !user ) {
      console.error( `❌ User with email ${ targetEmail } not found in SaaS DB.` );
      await saasClient.close();
      return;
    }
    console.log( `✅ Found SaaS User ID: ${ user._id }` );

    // 2. Connect to Bot DB and fetch the most recent trade record
    console.log( "🤖 Connecting to Bot DB to fetch the latest trade..." );
    const botDb = await getBotDb();
    const botTradesCollection = botDb.collection( "futures_history" );

    // Grab the most recent trade sorted by closedAt / exitTime descending
    const latestTrade = await botTradesCollection
      .find( { status: { $in: [ "CLOSED", "closed" ] } } )
      .sort( { closedAt: -1, exitTime: -1 } )
      .limit( 1 )
      .next();

    if ( !latestTrade ) {
      console.error( "❌ No closed trades found in Bot DB futures_history." );
      await saasClient.close();
      return;
    }

    console.log( `📈 Latest Bot Trade Found: ${ latestTrade.symbol } (${ latestTrade.side }) | PnL: ${ latestTrade.realizedPnL ?? latestTrade.pnl }` );

    // 3. Create the copy_trade_log record in the SaaS DB for this user
    const pnl = latestTrade.realizedPnL ?? latestTrade.pnl ?? 0;
    const margin = latestTrade.marginUsed || 100; // default fallback allocation
    const roi = latestTrade.roiPercentage ?? latestTrade.roi ?? 0;

    const copyLogRecord = {
      userId: user._id,
      email: targetEmail,
      leaderTradeId: latestTrade._id,
      symbol: latestTrade.symbol || latestTrade.leaderSymbol,
      side: latestTrade.side || latestTrade.leaderSide,
      entryPrice: latestTrade.entryPrice ?? latestTrade.avgEntryPrice ?? 0,
      exitPrice: latestTrade.exitPrice ?? latestTrade.stopLossHitPrice ?? 0,
      marginAllocated: margin,
      realizedPnl: pnl,
      roiPercentage: roi,
      status: "SUCCESS",
      executedAt: new Date( latestTrade.closedAt || latestTrade.exitTime || Date.now() ),
      createdAt: new Date(),
    };

    const insertResult = await copyLogsCollection.insertOne( copyLogRecord );
    console.log( `✨ Successfully created copy_trade_log entry [ID: ${ insertResult.insertedId }] for ${ targetEmail }` );

    // Clean up connections
    await saasClient.close();
    process.exit( 0 );
  } catch ( error ) {
    console.error( "❌ Failed to log user copy trade:", error );
    process.exit( 1 );
  }
}

logUserCopyTrade();
