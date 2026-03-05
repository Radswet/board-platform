-- ════════════════════════════════════════════════════════════════════
--  MIGRATION: Sistema de tableros múltiples + invitaciones
--  Idempotente: se puede ejecutar múltiples veces sin error
-- ════════════════════════════════════════════════════════════════════

-- ── 1. Tablas ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.boards (
  id         UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  name       TEXT        NOT NULL DEFAULT 'Mi Tablero',
  created_by UUID        REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS public.board_members (
  id        UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  board_id  UUID        NOT NULL REFERENCES public.boards(id) ON DELETE CASCADE,
  user_id   UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role      TEXT        NOT NULL DEFAULT 'editor' CHECK (role IN ('owner','editor','viewer')),
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(board_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.board_invites (
  id            UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  board_id      UUID        NOT NULL REFERENCES public.boards(id) ON DELETE CASCADE,
  invited_email TEXT        NOT NULL,
  invited_by    UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  role          TEXT        NOT NULL DEFAULT 'editor' CHECK (role IN ('editor','viewer')),
  status        TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted')),
  UNIQUE(board_id, invited_email)
);

ALTER TABLE public.links ADD COLUMN IF NOT EXISTS board_id UUID REFERENCES public.boards(id) ON DELETE CASCADE;

-- ── 2. Helper functions ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.my_role_in_board(p_board_id UUID)
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT role FROM public.board_members
  WHERE board_id = p_board_id AND user_id = auth.uid() LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.my_board_ids()
RETURNS SETOF UUID LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT board_id FROM public.board_members WHERE user_id = auth.uid();
$$;

-- ── 3. RLS boards ─────────────────────────────────────────────────────

ALTER TABLE public.boards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "boards_select" ON public.boards;
DROP POLICY IF EXISTS "boards_insert" ON public.boards;
DROP POLICY IF EXISTS "boards_update" ON public.boards;
DROP POLICY IF EXISTS "boards_delete" ON public.boards;

CREATE POLICY "boards_select" ON public.boards FOR SELECT TO authenticated USING (id IN (SELECT public.my_board_ids()) OR created_by = auth.uid());
CREATE POLICY "boards_insert" ON public.boards FOR INSERT TO authenticated WITH CHECK (created_by = auth.uid());
CREATE POLICY "boards_update" ON public.boards FOR UPDATE TO authenticated USING (public.my_role_in_board(id) = 'owner');
CREATE POLICY "boards_delete" ON public.boards FOR DELETE TO authenticated USING (public.my_role_in_board(id) = 'owner');

-- ── 4. RLS board_members ──────────────────────────────────────────────

ALTER TABLE public.board_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "board_members_select" ON public.board_members;
DROP POLICY IF EXISTS "board_members_insert" ON public.board_members;
DROP POLICY IF EXISTS "board_members_update" ON public.board_members;
DROP POLICY IF EXISTS "board_members_delete" ON public.board_members;

CREATE POLICY "board_members_select" ON public.board_members FOR SELECT TO authenticated USING (board_id IN (SELECT public.my_board_ids()));
CREATE POLICY "board_members_insert" ON public.board_members FOR INSERT TO authenticated WITH CHECK (public.my_role_in_board(board_id) = 'owner' OR user_id = auth.uid());
CREATE POLICY "board_members_update" ON public.board_members FOR UPDATE TO authenticated USING (public.my_role_in_board(board_id) = 'owner' AND user_id != auth.uid());
CREATE POLICY "board_members_delete" ON public.board_members FOR DELETE TO authenticated USING ((public.my_role_in_board(board_id) = 'owner' AND user_id != auth.uid()) OR user_id = auth.uid());

-- ── 5. RLS board_invites ──────────────────────────────────────────────

ALTER TABLE public.board_invites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "board_invites_select" ON public.board_invites;
DROP POLICY IF EXISTS "board_invites_insert" ON public.board_invites;
DROP POLICY IF EXISTS "board_invites_update" ON public.board_invites;
DROP POLICY IF EXISTS "board_invites_delete" ON public.board_invites;

CREATE POLICY "board_invites_select" ON public.board_invites FOR SELECT TO authenticated USING (public.my_role_in_board(board_id) = 'owner' OR invited_email = auth.email());
CREATE POLICY "board_invites_insert" ON public.board_invites FOR INSERT TO authenticated WITH CHECK (public.my_role_in_board(board_id) = 'owner');
CREATE POLICY "board_invites_update" ON public.board_invites FOR UPDATE TO authenticated USING (invited_email = auth.email() OR public.my_role_in_board(board_id) = 'owner');
CREATE POLICY "board_invites_delete" ON public.board_invites FOR DELETE TO authenticated USING (public.my_role_in_board(board_id) = 'owner');

-- ── 6. RLS links (reemplazar políticas anteriores) ────────────────────

DROP POLICY IF EXISTS "auth_select" ON public.links;
DROP POLICY IF EXISTS "auth_insert" ON public.links;
DROP POLICY IF EXISTS "auth_update" ON public.links;
DROP POLICY IF EXISTS "auth_delete" ON public.links;
DROP POLICY IF EXISTS "links_select" ON public.links;
DROP POLICY IF EXISTS "links_insert" ON public.links;
DROP POLICY IF EXISTS "links_update" ON public.links;
DROP POLICY IF EXISTS "links_delete" ON public.links;

CREATE POLICY "links_select" ON public.links FOR SELECT TO authenticated USING (board_id IS NULL OR board_id IN (SELECT public.my_board_ids()));
CREATE POLICY "links_insert" ON public.links FOR INSERT TO authenticated WITH CHECK (board_id IS NOT NULL AND public.my_role_in_board(board_id) IN ('owner','editor'));
CREATE POLICY "links_update" ON public.links FOR UPDATE TO authenticated USING (public.my_role_in_board(board_id) IN ('owner','editor'));
CREATE POLICY "links_delete" ON public.links FOR DELETE TO authenticated USING (public.my_role_in_board(board_id) IN ('owner','editor'));

-- ✅ Listo. La app migrará los links existentes al primer tablero automáticamente al hacer login.
