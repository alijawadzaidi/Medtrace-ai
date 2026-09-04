# Entity-relationship diagram

Generated from the live schema by `api/scripts/generate-erd.js`. Do not edit
by hand — regenerate it:

```bash
cd api && npm run docs:erd
```

A hand-drawn diagram is wrong within a week: someone adds a column and the
picture in the report keeps describing the database as it was in week three.
This one is read out of the tables the migrations produced, so it cannot drift.

```mermaid
erDiagram
    packs ||--o{ alerts : "pack"
    batches ||--o{ alerts : "batch"
    medicines ||--|{ batches : "medicine"
    organizations ||--|{ batches : "manufacturer"
    organizations ||--|{ medicines : "manufacturer"
    batches ||--|{ packs : "batch"
    organizations ||--o{ packs : "currentOrganization"
    packs ||--|{ scan_events : "pack"
    organizations ||--o{ scan_events : "organization"
    organizations ||--|{ shipments : "fromOrganization"
    organizations ||--|{ shipments : "toOrganization"
    shipments ||--|{ shipment_items : "shipment"
    packs ||--|{ shipment_items : "pack"
    organizations ||--|{ users : "organization"
    alerts {
        int id "PK"
        int pack_id "FK"
        int batch_id "FK"
        string rule
        string severity
        decimal score
        string status
        string summary
        string details
        int resolved_by_user_id "FK"
        datetime resolved_at
        string resolution_note
        datetime created_at
        datetime updated_at
    }
    audit_logs {
        int id "PK"
        int user_id "FK"
        int organization_id "FK"
        string action
        string entity
        string entity_id "FK"
        string changes
        string ip_address
        string request_id "FK"
        datetime created_at
    }
    batches {
        int id "PK"
        int medicine_id "FK"
        int manufacturer_id "FK"
        string batch_no "UK"
        string batch_code "UK"
        datetime manufactured_on
        datetime expires_on
        int quantity
        string status
        datetime recalled_at
        string recall_reason
        datetime created_at
        datetime updated_at
    }
    medicines {
        int id "PK"
        int manufacturer_id "FK, UK"
        string name "UK"
        string generic_name
        string strength "UK"
        string form "UK"
        string pack_size
        int is_active
        datetime created_at
        datetime updated_at
    }
    organizations {
        int id "PK"
        string name
        string type
        string license_no "UK"
        string city
        string country
        decimal latitude
        decimal longitude
        int is_active
        datetime created_at
        datetime updated_at
    }
    packs {
        int id "PK"
        int batch_id "FK"
        string serial "UK"
        int current_organization_id "FK"
        string state
        datetime dispensed_at
        int scan_count
        datetime last_scanned_at
        datetime created_at
        datetime updated_at
    }
    scan_events {
        int id "PK"
        int pack_id "FK"
        string type
        int organization_id "FK"
        int user_id "FK"
        int shipment_id "FK"
        decimal latitude
        decimal longitude
        string ip_address
        string user_agent
        string metadata
        datetime created_at
    }
    shipment_items {
        int id "PK"
        int shipment_id "FK, UK"
        int pack_id "FK"
        datetime created_at
    }
    shipments {
        int id "PK"
        string reference "UK"
        int from_organization_id "FK"
        int to_organization_id "FK"
        string status
        int created_by_user_id "FK"
        int received_by_user_id "FK"
        datetime dispatched_at
        datetime received_at
        string carrier
        string notes
        datetime created_at
        datetime updated_at
    }
    users {
        int id "PK"
        int organization_id "FK"
        string full_name
        string email "UK"
        string password_hash
        string role
        int is_active
        datetime last_login_at
        datetime created_at
        datetime updated_at
    }
```

## Tables

| Table | Rows in the development database |
| ----- | -------------------------------- |
| `alerts` | 166 |
| `audit_logs` | 581 |
| `batches` | 11 |
| `medicines` | 5 |
| `organizations` | 6 |
| `packs` | 936 |
| `scan_events` | 6,646 |
| `shipment_items` | 62 |
| `shipments` | 3 |
| `users` | 6 |

Row counts are whatever the local database happens to hold — they show the
shape of the demo data, not a property of the schema.

## Notes worth reading beside the diagram

- **`packs` is the table the project turns on.** One row per physical box, not
  per batch, which is what makes a duplicate scan evidence of a clone rather
  than ordinary traffic.
- **`scan_events` is append-only.** Never updated, never deleted. It is the
  regulator's trail, the customer's history, and the detector's training data
  at once.
- **`scan_events.organization_id` and `user_id` are nullable**, and that is
  load-bearing: a public verification has no actor, and their absence is a
  feature the model reads.
- **`alerts.pack_id` is nullable** so a batch-wide finding need not name a
  single pack.
- **`audit_logs` is written by a global Sequelize hook**, not by hand in each
  route, so tables added later are audited with no change to that code.

*Generated 2026-09-04.*
