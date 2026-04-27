import {MongoClient, ServerApiVersion} from 'mongodb';

let client: MongoClient | null = null;
let connectionPromise: Promise<MongoClient> | null = null;
let lastPingCheck = 0;
const PING_INTERVAL = 30000; // 30 seconds

export async function getMongoClient(): Promise<MongoClient> {
    // If we have a healthy client and it's recently pinged, return it
    if (client && (Date.now() - lastPingCheck <= PING_INTERVAL)) {
        return client;
    }

    // If a connection or health check is already in progress, wait for it
    if (connectionPromise) {
        return connectionPromise;
    }

    // Start connection or health check process
    connectionPromise = (async () => {
        try {
            const uri = process.env.MONGO_URI!;
            
            if (!client) {
                client = new MongoClient(uri, {
                    serverApi: {
                        version: ServerApiVersion.v1,
                        strict: true,
                        deprecationErrors: true,
                    },
                });
                await client.connect();
                lastPingCheck = Date.now();
            } else if (Date.now() - lastPingCheck > PING_INTERVAL) {
                try {
                    await client.db('admin').command({ping: 1});
                    lastPingCheck = Date.now();
                } catch (_error) {
                    // Connection lost, reconnect
                    await client.close().catch(() => {});
                    client = new MongoClient(uri);
                    await client.connect();
                    lastPingCheck = Date.now();
                }
            }
            return client!;
        } finally {
            connectionPromise = null;
        }
    })();

    return connectionPromise;
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
