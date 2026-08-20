-- ==========================================================
-- SUPABASE DATABASE INITIALIZATION FOR CRM FANPAGE
-- ==========================================================

-- 1. Table: pages
CREATE TABLE IF NOT EXISTS public.pages (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  page_id TEXT,
  page_url TEXT,
  category TEXT DEFAULT 'Của tôi',
  avatar_url TEXT,
  staff_name TEXT DEFAULT 'Chưa phân bổ',
  topic TEXT DEFAULT 'Chưa phân loại',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Table: daily_metrics (Báo cáo lịch sử theo ngày)
CREATE TABLE IF NOT EXISTS public.daily_metrics (
  id BIGSERIAL PRIMARY KEY,
  page_name TEXT NOT NULL,
  report_date DATE NOT NULL,
  views BIGINT DEFAULT 0,
  posts_per_day NUMERIC(10,2) DEFAULT 0,
  post_count INTEGER DEFAULT 0,
  interactions BIGINT DEFAULT 0,
  engagement_rate NUMERIC(10,4) DEFAULT 0,
  followers BIGINT DEFAULT 0,
  source TEXT DEFAULT 'Manual Sync',
  raw_data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(page_name, report_date)
);

-- 3. Table: master_pages (Phân bổ Fanpage cho nhân sự)
CREATE TABLE IF NOT EXISTS public.master_pages (
  id BIGSERIAL PRIMARY KEY,
  page_name TEXT NOT NULL,
  page_id TEXT,
  staff_name TEXT NOT NULL,
  department TEXT,
  topic TEXT DEFAULT 'Chưa phân loại',
  bm TEXT,
  workflow TEXT,
  status TEXT DEFAULT 'Active',
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Table: staff (Tài khoản nhân sự)
CREATE TABLE IF NOT EXISTS public.staff (
  id BIGSERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  code TEXT,
  department TEXT DEFAULT 'Aff Decor',
  role TEXT DEFAULT 'staff',
  password TEXT DEFAULT '123456',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Table: posts (Top Content)
CREATE TABLE IF NOT EXISTS public.posts (
  id BIGSERIAL PRIMARY KEY,
  post_id TEXT UNIQUE,
  page_name TEXT NOT NULL,
  message TEXT,
  post_url TEXT,
  thumbnail_url TEXT,
  media_type TEXT DEFAULT 'video',
  likes BIGINT DEFAULT 0,
  comments BIGINT DEFAULT 0,
  shares BIGINT DEFAULT 0,
  interactions BIGINT DEFAULT 0,
  reach BIGINT DEFAULT 0,
  engagement_rate NUMERIC(10,4) DEFAULT 0,
  ipi NUMERIC(10,4) DEFAULT 0,
  negative_sentiment NUMERIC(10,4) DEFAULT 0,
  published_at TIMESTAMPTZ DEFAULT NOW(),
  source TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Table: app_settings
CREATE TABLE IF NOT EXISTS public.app_settings (
  id BIGSERIAL PRIMARY KEY,
  key TEXT UNIQUE NOT NULL,
  value TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Row Level Security (RLS) configuration
ALTER TABLE public.pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.master_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

-- Allow full public / API access
CREATE POLICY "Allow all access to pages" ON public.pages FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access to daily_metrics" ON public.daily_metrics FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access to master_pages" ON public.master_pages FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access to staff" ON public.staff FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access to posts" ON public.posts FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access to app_settings" ON public.app_settings FOR ALL USING (true) WITH CHECK (true);
