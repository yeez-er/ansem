# Drizzle ORM Wisdom

- `db.query.*.findFirst` is the cleanest pattern for ownership lookups. [from: BoxBox]
- Drizzle insert chain: `.values()` sometimes chains `.returning()` — mock must handle both. [from: BoxBox]
- Drizzle multiline chains break `.toContain()` assertions. Use regex with `[\s\n]*` instead. [from: BoxBox]
- Drizzle select mock must be thenable (Promise.resolve), not a plain object. [from: BoxBox]
- `db.update().set()` without `.where()` updates ALL rows — use source verification regex: `/.update\(table\)\.set\(\{[\s\S]*?\}\)\.where\(/g`. [from: BoxBox]
- `getTableConfig(table).checks` returns CHECK constraints; `getTableColumns(table)` for column metadata introspection. [from: BoxBox]
- `onDelete: 'cascade'` breaks `.toContain('.references()')` tests — switch to `.toMatch()` regex pattern. [from: BoxBox]
- Schema JS property renames: change schema -> rebuild `dist/` -> grep ALL consumers across monorepo -> update. [from: BoxBox]
- Pre-check queries stay OUTSIDE `db.transaction()` to minimize lock duration. Writes inside transaction. [from: BoxBox]
