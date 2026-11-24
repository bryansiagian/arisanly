CREATE TABLE arisanly.groups (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
    type text NOT NULL CHECK (type IN ('ARISAN', 'KAS')),
    created_by uuid NOT NULL REFERENCES arisanly.users(id),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE arisanly.group_members (
    group_id uuid NOT NULL REFERENCES arisanly.groups(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES arisanly.users(id),
    role text NOT NULL CHECK (role IN ('OWNER', 'TREASURER', 'MEMBER')),
    joined_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (group_id, user_id)
);

CREATE UNIQUE INDEX group_single_owner ON arisanly.group_members(group_id) WHERE role = 'OWNER';
CREATE INDEX group_members_user_idx ON arisanly.group_members(user_id, group_id);

CREATE TABLE arisanly.invites (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id uuid NOT NULL REFERENCES arisanly.groups(id) ON DELETE CASCADE,
    code_hash bytea NOT NULL UNIQUE,
    expires_at timestamptz NOT NULL,
    max_uses int NOT NULL CHECK (max_uses BETWEEN 1 AND 100),
    used_count int NOT NULL DEFAULT 0 CHECK (used_count BETWEEN 0 AND max_uses)
);

CREATE INDEX invites_group_id_idx ON arisanly.invites(group_id);
