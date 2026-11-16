export const DBML_GUIDE = `SchemaSketch's schema language (a DBML subset). Write the whole diagram as one text block.

TABLES
  Table users {
    id int [pk, increment]
    email varchar [unique, not null]
    role varchar [default: 'member']
    bio text [note: 'shown on public profile']
  }

  Column attributes go in [brackets], comma-separated: pk, increment, not null, unique,
  default: 'value', note: 'text'. A note can also be multi-line with triple quotes:
    Note: '''
      Line one.
      Line two.
    '''
  (that form works as a table-level Note: too, on its own line inside the Table block.)

  Recognized types (case-insensitive): int, integer, smallint, bigint, decimal, numeric,
  float, double, serial, bigserial, varchar, char, text, string, uuid, boolean, bool,
  date, datetime, timestamp, time, json, jsonb, blob, binary. varchar/char/decimal accept
  a size, e.g. varchar(255), decimal(10,2). Anything else is flagged as an unrecognized type.

  Table color: Table orders [headercolor: '#22c55e'] { ... }

  Indexes (optional, inside a Table block, after the columns):
    Indexes {
      email [unique]
      (first_name, last_name) [name: 'name_idx']
      (org_id, slug) [pk]
    }
  A bare entry is a plain index; parens group multiple columns into one
  composite index; [unique] makes it a unique index; [pk] makes it a
  (possibly composite) primary key instead; [name: '...'] sets an explicit
  index name.

RELATIONSHIPS (declare after the tables, not inside them)
  Ref: posts.user_id > users.id [delete: cascade, update: restrict]
  >  many-to-one (left side has the foreign key)   <  one-to-many (reversed)
  -  one-to-one                                     <>  many-to-many (no FK generated on export)
  The trailing [delete: ..., update: ...] is optional and sets the foreign
  key's referential actions - one of cascade, restrict, set null, set
  default, no action. Omit either to leave that action at the database's
  default.

ENUMS
  Enum status {
    active
    inactive
    banned
  }
  Use it as a column type: status status

SUBJECT AREAS (purely visual — group related tables under a labeled, colored region)
  TableGroup billing [color: '#a855f7'] {
    invoices
    payments
  }

RULES
  - Table and column names: no spaces (use snake_case). Every table needs at least one column.
  - Exactly one Table block per table name; Ref lines go outside any Table block.
  - A "one" side of a relationship should be the table's pk or a unique column — otherwise
    validate_dbml will warn (not error) that the foreign key can't really be enforced.
  - Prefer editing an existing table/column in place over restating the whole diagram, so
    unrelated formatting and comments the user wrote aren't lost.`;
