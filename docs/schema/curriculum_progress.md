# Curriculum Progress Schema

To support the `FullJourneyPath` visual curriculum map, we need to extend our Supabase schema to represent curriculum paths and student progress through those paths.

## Tables

### 1. `curriculum_nodes`
Represents the static layout of a curriculum path.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | `uuid` | Primary Key | Unique identifier for the node |
| `course_id` | `uuid` | Foreign Key (`courses.id`) | The course this node belongs to |
| `lecture_id` | `uuid` | Foreign Key (`lectures.id`) | The lecture this node represents (nullable if it represents a milestone/checkpoint instead) |
| `label` | `text` | Not Null | Display label on the curriculum map |
| `position_order` | `integer` | Not Null | Sequence order in the path |
| `created_at` | `timestamptz` | Not Null | Default `now()` |
| `updated_at` | `timestamptz` | Not Null | Default `now()` |

### 2. `curriculum_edges` (Optional, if non-linear paths are needed)
Represents the connections between nodes. For a strictly linear path, `position_order` in `curriculum_nodes` is sufficient.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | `uuid` | Primary Key | Unique identifier for the edge |
| `source_node_id`| `uuid` | Foreign Key (`curriculum_nodes.id`) | The starting node |
| `target_node_id`| `uuid` | Foreign Key (`curriculum_nodes.id`) | The destination node |

### 3. `student_node_progress`
Tracks a student's state for a specific curriculum node.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | `uuid` | Primary Key | Unique identifier |
| `user_id` | `uuid` | Foreign Key (`auth.users.id`) | The student |
| `node_id` | `uuid` | Foreign Key (`curriculum_nodes.id`)| The curriculum node |
| `status` | `text` | Check (`locked`, `active`, `completed`) | Current status of the node for this student |
| `unlocked_at` | `timestamptz` | Nullable | When the node became `active` |
| `completed_at`| `timestamptz` | Nullable | When the node became `completed` |
| `created_at` | `timestamptz` | Not Null | Default `now()` |
| `updated_at` | `timestamptz` | Not Null | Default `now()` |

## Notes
- To calculate a student's full journey, we can perform a join query fetching all `curriculum_nodes` for a given `course_id`, left joined with `student_node_progress` for the `user_id`. If progress doesn't exist for a node, its status defaults to `locked`.
- Progress transitions (locked -> active -> completed) can be handled via Supabase Triggers reacting to `lecture_progress` updates (e.g., when a lecture is completed, the corresponding node is marked completed, and the next node is marked active).
