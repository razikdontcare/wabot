import {MongoClient, ServerApiVersion} from 'mongodb';

let client: MongoClient | null = null;
let lastPingCheck = 0;
const PING_INTERVAL = 30000; // 30 seconds

export async function getMongoClient(): Promise<MongoClient> {
    if (!client) {
        const uri = process.env.MONGO_URI!;
        client = new MongoClient(uri, {
            serverApi: {
                version: ServerApiVersion.v1,
                strict: true,
                deprecationErrors: true,
            },
        });
        await client.connect();
        lastPingCheck = Date.now();
    }

    // Only ping if we haven't checked recently
    const now = Date.now();
    if (now - lastPingCheck > PING_INTERVAL) {
        try {
            await client.db('admin').command({ping: 1});
            lastPingCheck = now;
        } catch (_error) {
            // Connection lost, reconnect
            if (client) {
                await client.close().catch(() => {
                });
            }
            client = new MongoClient(process.env.MONGO_URI!);
            await client.connect();
            lastPingCheck = now;
        }
    }

    return client;
}

export async function closeMongoClient(): Promise<void> {
    if (client) {
        await client.close();
        client = null;
    }
}

export function isMongoConnected(): boolean {
    return client !== null;
}
