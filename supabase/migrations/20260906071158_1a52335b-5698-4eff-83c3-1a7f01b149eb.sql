CREATE TABLE IF NOT EXISTS public.settings (
  user_id UUID NOT NULL PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  account_balance NUMERIC NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  risk_pct NUMERIC NOT NULL DEFAULT 1,
  min_rr NUMERIC NOT NULL DEFAULT 2,
  min_sample_size INTEGER NOT NULL DEFAULT 100,
  require_volume BOOLEAN NOT NULL DEFAULT false,
  learning_mode BOOLEAN NOT NULL DEFAULT false,
  strict_mode BOOLEAN NOT NULL DEFAULT true,
  beginner_mode BOOLEAN NOT NULL DEFAULT true,
  preferred_assets TEXT[] NOT NULL DEFAULT ARRAY['BTCUSD','ETHUSD','XAUUSD','EURUSD','NVDA','AMD'],
  preferred_timeframes TEXT[] NOT NULL DEFAULT ARRAY['1D','4H','1H','15M','5M'],
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.settings TO authenticated;
GRANT ALL ON public.settings TO service_role;
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own settings" ON public.settings;
CREATE POLICY "own settings" ON public.settings FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.analyses (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  asset TEXT NOT NULL DEFAULT 'UNKNOWN',
  market_type TEXT NOT NULL DEFAULT 'unknown',
  timeframes TEXT[] NOT NULL DEFAULT '{}',
  primary_timeframe TEXT,
  direction TEXT NOT NULL DEFAULT 'NO TRADE',
  setup_stage TEXT NOT NULL DEFAULT 'SETUP FORMING',
  score INTEGER NOT NULL DEFAULT 0,
  max_score INTEGER NOT NULL DEFAULT 16,
  grade TEXT NOT NULL DEFAULT 'D',
  visual_evidence TEXT NOT NULL DEFAULT 'LOW',
  htf_bias TEXT NOT NULL DEFAULT 'UNCONFIRMED',
  checklist JSONB NOT NULL DEFAULT '[]'::jsonb,
  entry_zone TEXT,
  stop_loss TEXT,
  tp1 TEXT,
  tp2 TEXT,
  risk_reward NUMERIC,
  required_confirmation JSONB NOT NULL DEFAULT '[]'::jsonb,
  invalidation JSONB NOT NULL DEFAULT '[]'::jsonb,
  reasoning JSONB NOT NULL DEFAULT '[]'::jsonb,
  summary TEXT,
  sufficient_information BOOLEAN NOT NULL DEFAULT false,
  requested_additional_images JSONB NOT NULL DEFAULT '[]'::jsonb,
  raw JSONB,
  outcome TEXT NOT NULL DEFAULT 'OPEN',
  r_result NUMERIC,
  invalidation_reason TEXT,
  notes TEXT,
  closed_at TIMESTAMPTZ,
  source TEXT NOT NULL DEFAULT 'app',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT score_within_max CHECK (score >= 0 AND score <= max_score),
  CONSTRAINT valid_outcome CHECK (outcome IN ('OPEN','WIN','LOSS','BREAKEVEN','INVALIDATED','MISSED','NO TRADE')),
  CONSTRAINT valid_direction CHECK (direction IN ('POTENTIAL LONG','POTENTIAL SHORT','WAIT','NO TRADE','INSUFFICIENT DATA'))
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.analyses TO authenticated;
GRANT ALL ON public.analyses TO service_role;
ALTER TABLE public.analyses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own analyses" ON public.analyses;
CREATE POLICY "own analyses" ON public.analyses FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS analyses_user_created_idx ON public.analyses (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS analyses_user_source_created_idx ON public.analyses (user_id, source, created_at DESC);

CREATE TABLE IF NOT EXISTS public.analysis_images (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  analysis_id UUID NOT NULL REFERENCES public.analyses ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  timeframe TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.analysis_images TO authenticated;
GRANT ALL ON public.analysis_images TO service_role;
ALTER TABLE public.analysis_images ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own analysis images" ON public.analysis_images;
CREATE POLICY "own analysis images" ON public.analysis_images FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.touch_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS settings_touch ON public.settings;
CREATE TRIGGER settings_touch BEFORE UPDATE ON public.settings FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
DROP TRIGGER IF EXISTS analyses_touch ON public.analyses;
CREATE TRIGGER analyses_touch BEFORE UPDATE ON public.analyses FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE IF NOT EXISTS public.learning_progress (
  user_id uuid NOT NULL PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  state jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.learning_progress TO authenticated;
GRANT ALL ON public.learning_progress TO service_role;
ALTER TABLE public.learning_progress ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own learning progress" ON public.learning_progress;
CREATE POLICY "own learning progress" ON public.learning_progress FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP TRIGGER IF EXISTS learning_progress_touch ON public.learning_progress;
CREATE TRIGGER learning_progress_touch BEFORE UPDATE ON public.learning_progress FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM ('admin', 'user');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can read own roles" ON public.user_roles;
CREATE POLICY "Users can read own roles" ON public.user_roles FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO service_role;

CREATE TABLE IF NOT EXISTS public.premium_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  duration_days integer NOT NULL CHECK (duration_days > 0),
  max_uses integer NOT NULL DEFAULT 1 CHECK (max_uses > 0),
  uses integer NOT NULL DEFAULT 0,
  expires_at timestamptz,
  note text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON public.premium_codes FROM anon, authenticated;
GRANT ALL ON public.premium_codes TO service_role;
ALTER TABLE public.premium_codes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "No client access to premium_codes" ON public.premium_codes;
CREATE POLICY "No client access to premium_codes" ON public.premium_codes FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

CREATE TABLE IF NOT EXISTS public.premium_access (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  premium_until timestamptz NOT NULL,
  last_code text,
  market_data_enabled boolean NOT NULL DEFAULT false,
  hidden_pages text[] NOT NULL DEFAULT '{}'::text[],
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.premium_access TO authenticated;
GRANT ALL ON public.premium_access TO service_role;
ALTER TABLE public.premium_access ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can read own premium access" ON public.premium_access;
CREATE POLICY "Users can read own premium access" ON public.premium_access FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE TABLE IF NOT EXISTS public.notes (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'Untitled note',
  body text NOT NULL DEFAULT '',
  style jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notes TO authenticated;
GRANT ALL ON public.notes TO service_role;
ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own notes" ON public.notes;
CREATE POLICY "own notes" ON public.notes FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS notes_user_updated_idx ON public.notes (user_id, updated_at DESC);
DROP TRIGGER IF EXISTS notes_touch_updated_at ON public.notes;
CREATE TRIGGER notes_touch_updated_at BEFORE UPDATE ON public.notes FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE IF NOT EXISTS public.ohlc_data (
  id bigserial PRIMARY KEY,
  symbol text NOT NULL,
  timeframe text NOT NULL,
  time timestamptz NOT NULL,
  open double precision NOT NULL,
  high double precision NOT NULL,
  low double precision NOT NULL,
  close double precision NOT NULL,
  tick_volume double precision,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (symbol, timeframe, time)
);
REVOKE ALL ON public.ohlc_data FROM anon, authenticated;
GRANT ALL ON public.ohlc_data TO service_role;
GRANT ALL ON SEQUENCE public.ohlc_data_id_seq TO service_role;
ALTER TABLE public.ohlc_data ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "No client access to ohlc_data" ON public.ohlc_data;
CREATE POLICY "No client access to ohlc_data" ON public.ohlc_data FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE INDEX IF NOT EXISTS ohlc_data_symbol_tf_time_idx ON public.ohlc_data (symbol, timeframe, time DESC);

CREATE OR REPLACE FUNCTION public.ohlc_symbols()
RETURNS setof text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  select distinct symbol from public.ohlc_data where symbol is not null order by 1
$$;

CREATE OR REPLACE FUNCTION public.ohlc_timeframes(_symbol text)
RETURNS setof text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  select distinct timeframe from public.ohlc_data
  where symbol = _symbol and timeframe is not null
  order by 1
$$;
REVOKE EXECUTE ON FUNCTION public.ohlc_symbols() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.ohlc_timeframes(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ohlc_symbols() TO service_role;
GRANT EXECUTE ON FUNCTION public.ohlc_timeframes(text) TO service_role;

ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS den_rules jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS public.screenshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'Screenshot',
  storage_path text not null,
  symbol text,
  timeframe text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.screenshots TO authenticated;
GRANT ALL ON public.screenshots TO service_role;
ALTER TABLE public.screenshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own screenshots" ON public.screenshots;
CREATE POLICY "own screenshots" ON public.screenshots FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP TRIGGER IF EXISTS screenshots_touch ON public.screenshots;
CREATE TRIGGER screenshots_touch BEFORE UPDATE ON public.screenshots FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE INDEX IF NOT EXISTS screenshots_user_created_idx ON public.screenshots (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.den_presets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  components jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.den_presets TO authenticated;
GRANT ALL ON public.den_presets TO service_role;
ALTER TABLE public.den_presets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own den presets" ON public.den_presets;
CREATE POLICY "own den presets" ON public.den_presets FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "own chart files read" ON storage.objects;
CREATE POLICY "own chart files read" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'chart-screenshots' AND owner = auth.uid());
DROP POLICY IF EXISTS "own chart files insert" ON storage.objects;
CREATE POLICY "own chart files insert" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'chart-screenshots' AND owner = auth.uid());
DROP POLICY IF EXISTS "own chart files delete" ON storage.objects;
CREATE POLICY "own chart files delete" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'chart-screenshots' AND owner = auth.uid());
DROP POLICY IF EXISTS "Owners can update their chart screenshots" ON storage.objects;
CREATE POLICY "Owners can update their chart screenshots" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'chart-screenshots' AND owner = auth.uid()) WITH CHECK (bucket_id = 'chart-screenshots' AND owner = auth.uid());