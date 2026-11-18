// Run:  node --env-file=.env.local scripts/test-db.mjs
import { MongoClient } from 'mongodb';

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('MONGODB_URI is not set. Run with: node --env-file=.env.local scripts/test-db.mjs');
  process.exit(1);
}

const client = new MongoClient(uri, { serverSelectionTimeoutMS: 15000, family: 4 });
try {
  await client.connect();
  await client.db('admin').command({ ping: 1 });
  console.log('✅ Connected to MongoDB Atlas successfully');
} catch (e) {
  console.error('❌ Connection failed:', e.message);
  console.error('\nIf you see "tlsv1 alert internal error": add your IP in Atlas -> Network Access.');
} finally {
  await client.close();
}
