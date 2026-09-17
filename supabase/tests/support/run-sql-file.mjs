import fs from "node:fs";
import pg from "pg";

const { Client } = pg;

async function main() {
  const [databaseUrl, filePath] = process.argv.slice(2);
  if (!databaseUrl || !filePath) {
    throw new Error("usage: node run-sql-file.mjs <database-url> <sql-file>");
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const results = await client.query(fs.readFileSync(filePath, "utf8"));
    const list = Array.isArray(results) ? results : [results];
    for (const result of list) {
      for (const row of result.rows ?? []) {
        process.stdout.write(`${Object.values(row).join("\t")}\n`);
      }
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
