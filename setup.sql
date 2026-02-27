-- ════════════════════════════════════════════════════════════════════
--  SETUP SUPABASE – ejecuta esto en el SQL Editor de tu proyecto
--  https://supabase.com/dashboard → SQL Editor → New query
-- ════════════════════════════════════════════════════════════════════

-- 1. Tabla de links
CREATE TABLE IF NOT EXISTS links (
  id           UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  created_by   UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  name         TEXT        NOT NULL,
  url          TEXT        NOT NULL,
  icon         TEXT        DEFAULT '🔗',
  description  TEXT        DEFAULT '',
  group_name   TEXT        DEFAULT '',
  color        TEXT        DEFAULT '#60a5fa',
  position     INTEGER     DEFAULT 0
);

-- 2. Activa Row Level Security (RLS)
ALTER TABLE links ENABLE ROW LEVEL SECURITY;

-- 3. Políticas: cualquier usuario autenticado puede leer y escribir
--    (todos los del equipo con cuenta pueden editar el tablero)
CREATE POLICY "auth_select" ON links
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "auth_insert" ON links
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "auth_update" ON links
  FOR UPDATE TO authenticated USING (true);

CREATE POLICY "auth_delete" ON links
  FOR DELETE TO authenticated USING (true);

-- 4. Activa Realtime para que los cambios se vean en tiempo real
ALTER PUBLICATION supabase_realtime ADD TABLE links;

-- 5. Límite de usuarios (máximo 5)
--    Crea tabla profiles y un trigger en public que se dispara al registrar usuarios.
CREATE TABLE IF NOT EXISTS public.profiles (
  id         UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email      TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles_select" ON public.profiles
  FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF (SELECT COUNT(*) FROM public.profiles) >= 5 THEN
    RAISE EXCEPTION 'Límite de usuarios alcanzado.';
  END IF;
  INSERT INTO public.profiles (id, email) VALUES (NEW.id, NEW.email);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ✅ Listo. Ahora ve a index.html y pega tu URL y anon key.
