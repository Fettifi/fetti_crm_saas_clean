import { Client } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

async function testConnection() {
    const connectionString = process.env.DATABASE_URL;

    if (!connectionString) {
        console.error("❌ DATABASE_URL is missing from .env");
        process.exit(1);
    }

    console.log(`Testing connection to: ${connectionString.replace(/:[^:]*@/, ':****@')} ...`);

    const client = new Client({
        connectionString,
        ssl: { rejectUnauthorized: false } // Common requirement for Supabase/Vercel
    });

    try {
        await client.connect();
        console.log("✅ Connected successfully!");

        const res = await client.query('SELECT NOW()');
        console.log("Query Result:", res.rows[0]);

        await client.end();
        process.exit(0);
    } catch (err: any) {
        console.error("❌ Connection Failed:", err.message);
        if (err.code) console.error("Error Code:", err.code);
        process.exit(1);
    }
}

testConnection();
