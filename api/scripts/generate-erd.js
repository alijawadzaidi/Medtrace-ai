'use strict';

/**
 * Exports an entity-relationship diagram from the **live schema**.
 *
 * Hand-drawn ER diagrams are wrong within a week — someone adds a column and
 * the diagram in the report keeps describing the database as it was in week
 * three. This reads the tables the migrations actually produced, so the
 * diagram cannot drift from the schema it documents.
 *
 * Output is Mermaid, which GitHub renders inline and which pastes into the
 * report as either a picture or its source.
 *
 * Usage: node scripts/generate-erd.js [--out ../docs/erd.md]
 */

const fs = require('node:fs');
const path = require('node:path');

const { sequelize } = require('../src/models');

/** Mermaid's type vocabulary is loose; these keep the diagram readable. */
function simplifyType(type) {
  const raw = String(type || '').toUpperCase();
  if (raw.includes('INT')) return 'int';
  if (raw.includes('CHAR') || raw.includes('TEXT') || raw.includes('ENUM')) return 'string';
  if (raw.includes('DATE') || raw.includes('TIME')) return 'datetime';
  if (raw.includes('FLOAT') || raw.includes('DOUBLE') || raw.includes('DECIMAL')) return 'decimal';
  if (raw.includes('BOOL') || raw.includes('TINYINT(1)')) return 'boolean';
  return 'string';
}

/**
 * Relationships come from the models rather than the database, deliberately.
 * SQLite reports foreign keys inconsistently across versions, and the
 * associations are what the application actually enforces and traverses.
 */
function relationships(db) {
  const edges = [];

  for (const model of Object.values(db)) {
    if (!model?.associations) continue;

    for (const association of Object.values(model.associations)) {
      if (association.associationType !== 'BelongsTo') continue;

      edges.push({
        from: association.target.tableName,
        to: association.source.tableName,
        label: association.as,
        // A nullable foreign key is an optional relationship, and saying so is
        // most of what an ER diagram is for: `scan_events.organization_id` is
        // null for a public scan, and that absence is meaningful.
        optional: association.source.rawAttributes[association.foreignKey]?.allowNull !== false,
      });
    }
  }

  return edges;
}

async function main() {
  const outIndex = process.argv.indexOf('--out');
  const out =
    outIndex > -1
      ? path.resolve(process.argv[outIndex + 1])
      : path.join(__dirname, '..', '..', 'docs', 'erd.md');

  const queryInterface = sequelize.getQueryInterface();
  const tables = (await queryInterface.showAllTables())
    .map((t) => (typeof t === 'string' ? t : t.tableName))
    .filter((t) => !['SequelizeMeta', 'sequelize_seeds'].includes(t))
    .sort();

  if (!tables.length) {
    throw new Error('No tables. Run `npm run db:migrate` first.');
  }

  const db = require('../src/models');
  const edges = relationships(db);

  const lines = ['erDiagram'];

  for (const edge of edges) {
    // one-to-many, optional on the "many" side when the key is nullable
    const cardinality = edge.optional ? '||--o{' : '||--|{';
    lines.push(`    ${edge.from} ${cardinality} ${edge.to} : "${edge.label}"`);
  }

  for (const table of tables) {
    const columns = await queryInterface.describeTable(table);
    lines.push(`    ${table} {`);

    for (const [name, definition] of Object.entries(columns)) {
      const flags = [];
      if (definition.primaryKey) flags.push('PK');
      if (name.endsWith('_id') && !definition.primaryKey) flags.push('FK');
      if (definition.unique && !definition.primaryKey) flags.push('UK');
      const comment = flags.length ? ` "${flags.join(', ')}"` : '';
      lines.push(`        ${simplifyType(definition.type)} ${name}${comment}`);
    }

    lines.push('    }');
  }

  const counts = [];
  for (const table of tables) {
    const [[row]] = await sequelize.query(`SELECT COUNT(*) AS count FROM \`${table}\``);
    counts.push({ table, rows: Number(row.count) });
  }

  const document = `# Entity-relationship diagram

Generated from the live schema by \`api/scripts/generate-erd.js\`. Do not edit
by hand — regenerate it:

\`\`\`bash
cd api && npm run docs:erd
\`\`\`

A hand-drawn diagram is wrong within a week: someone adds a column and the
picture in the report keeps describing the database as it was in week three.
This one is read out of the tables the migrations produced, so it cannot drift.

\`\`\`mermaid
${lines.join('\n')}
\`\`\`

## Tables

| Table | Rows in the development database |
| ----- | -------------------------------- |
${counts.map((c) => `| \`${c.table}\` | ${c.rows.toLocaleString()} |`).join('\n')}

Row counts are whatever the local database happens to hold — they show the
shape of the demo data, not a property of the schema.

## Notes worth reading beside the diagram

- **\`packs\` is the table the project turns on.** One row per physical box, not
  per batch, which is what makes a duplicate scan evidence of a clone rather
  than ordinary traffic.
- **\`scan_events\` is append-only.** Never updated, never deleted. It is the
  regulator's trail, the customer's history, and the detector's training data
  at once.
- **\`scan_events.organization_id\` and \`user_id\` are nullable**, and that is
  load-bearing: a public verification has no actor, and their absence is a
  feature the model reads.
- **\`alerts.pack_id\` is nullable** so a batch-wide finding need not name a
  single pack.
- **\`audit_logs\` is written by a global Sequelize hook**, not by hand in each
  route, so tables added later are audited with no change to that code.

*Generated ${new Date().toISOString().slice(0, 10)}.*
`;

  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, document);

  console.log(`Wrote ${out}`);
  console.log(`  ${tables.length} tables, ${edges.length} relationships`);

  await sequelize.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
