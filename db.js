const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

let dbPath = path.join(__dirname, 'crm_fanpage.db');

if (process.env.VERCEL) {
  // In Vercel serverless environment, filesystem is read-only except /tmp
  const tmpDbPath = path.join('/tmp', 'crm_fanpage.db');
  if (!fs.existsSync(tmpDbPath)) {
    try {
      if (fs.existsSync(dbPath)) {
        fs.copyFileSync(dbPath, tmpDbPath);
      }
    } catch (err) {
      console.error('Failed to copy db to /tmp:', err);
    }
  }
  dbPath = tmpDbPath;
}

const db = new Database(dbPath);

// Enable WAL mode for concurrency performance
try {
  db.pragma('journal_mode = WAL');
} catch (e) {
  console.warn('WAL mode warning:', e.message);
}

// Initialize tables
function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS pages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      page_id TEXT,
      page_url TEXT,
      category TEXT DEFAULT 'Của tôi',
      avatar_url TEXT,
      staff_name TEXT DEFAULT 'Chưa phân bổ',
      topic TEXT DEFAULT 'Chưa phân loại',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS staff (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      code TEXT,
      role TEXT DEFAULT 'staff',
      password TEXT DEFAULT '123456',
      department TEXT DEFAULT 'Content Marketing',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS master_pages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      page_name TEXT NOT NULL,
      page_id TEXT,
      staff_name TEXT NOT NULL,
      department TEXT,
      topic TEXT DEFAULT 'Chưa phân loại',
      bm TEXT,
      workflow TEXT,
      status TEXT DEFAULT 'Active',
      note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS daily_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      page_name TEXT NOT NULL,
      report_date TEXT NOT NULL,
      views INTEGER DEFAULT 0,
      posts_per_day REAL DEFAULT 0,
      post_count INTEGER DEFAULT 0,
      interactions INTEGER DEFAULT 0,
      engagement_rate REAL DEFAULT 0,
      followers INTEGER DEFAULT 0,
      source TEXT DEFAULT 'Google Apps Script',
      raw_data TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(page_name, report_date) ON CONFLICT REPLACE
    );

    CREATE TABLE IF NOT EXISTS webhook_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_email TEXT,
      status TEXT,
      record_count INTEGER DEFAULT 0,
      message TEXT,
      raw_payload TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      page_name TEXT NOT NULL,
      post_id TEXT,
      post_url TEXT,
      message TEXT,
      thumbnail_url TEXT,
      media_type TEXT DEFAULT 'video',
      published_at DATETIME,
      likes INTEGER DEFAULT 0,
      comments INTEGER DEFAULT 0,
      shares INTEGER DEFAULT 0,
      interactions INTEGER DEFAULT 0,
      interaction_rate REAL DEFAULT 0,
      reach INTEGER DEFAULT 0,
      interactions_per_impression REAL DEFAULT 0,
      negative_sentiment_share REAL DEFAULT 0,
      staff_name TEXT DEFAULT 'Chưa phân bổ',
      source TEXT DEFAULT 'Fanpage Karma',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  // Migration: add columns if not exists
  try { db.exec("ALTER TABLE pages ADD COLUMN page_id TEXT;"); } catch (e) {}
  try { db.exec("ALTER TABLE pages ADD COLUMN staff_name TEXT DEFAULT 'Chưa phân bổ';"); } catch (e) {}
  try { db.exec("ALTER TABLE pages ADD COLUMN topic TEXT DEFAULT 'Chưa phân loại';"); } catch (e) {}
  try { db.exec("ALTER TABLE master_pages ADD COLUMN topic TEXT DEFAULT 'Chưa phân loại';"); } catch (e) {}
  try { db.exec("ALTER TABLE master_pages ADD COLUMN bm TEXT;"); } catch (e) {}
  try { db.exec("ALTER TABLE master_pages ADD COLUMN workflow TEXT;"); } catch (e) {}
  try { db.exec("ALTER TABLE master_pages ADD COLUMN status TEXT DEFAULT 'Active';"); } catch (e) {}
  try { db.exec("ALTER TABLE staff ADD COLUMN role TEXT DEFAULT 'staff';"); } catch (e) {}
  try { db.exec("ALTER TABLE staff ADD COLUMN password TEXT DEFAULT '123456';"); } catch (e) {}

  // Ensure Admin account exists with password Admin@191
  db.prepare("INSERT OR IGNORE INTO staff (name, role, password, department) VALUES ('Admin', 'admin', 'Admin@191', 'Ban Giám Đốc')").run();
  db.prepare("UPDATE staff SET password = 'Admin@191' WHERE role = 'admin' OR name = 'Admin'").run();

  // Migration: clean deleted staff & rename requested staff
  try {
    db.prepare("DELETE FROM staff WHERE name IN ('Trần Thị B', 'Mai Đức', 'Nguyễn Văn A')").run();
    db.prepare("DELETE FROM master_pages WHERE staff_name IN ('Trần Thị B', 'Mai Đức', 'Nguyễn Văn A')").run();
    db.prepare("UPDATE pages SET staff_name = 'Chưa phân bổ' WHERE staff_name IN ('Trần Thị B', 'Mai Đức', 'Nguyễn Văn A')").run();
    db.prepare("UPDATE posts SET staff_name = 'Chưa phân bổ' WHERE staff_name IN ('Trần Thị B', 'Mai Đức', 'Nguyễn Văn A')").run();

    db.prepare("UPDATE pages SET staff_name = 'Mai Văn Đức ( AFF Fitness)' WHERE staff_name = 'Đức n8n Fitness'").run();
    db.prepare("UPDATE master_pages SET staff_name = 'Mai Văn Đức ( AFF Fitness)', department = 'AFF Fitness' WHERE staff_name = 'Đức n8n Fitness'").run();
    db.prepare("UPDATE posts SET staff_name = 'Mai Văn Đức ( AFF Fitness)' WHERE staff_name = 'Đức n8n Fitness'").run();

    db.prepare("UPDATE pages SET staff_name = 'Mai Văn Đức ( AFF Decor)' WHERE staff_name = 'Đức decor n8n'").run();
    db.prepare("UPDATE master_pages SET staff_name = 'Mai Văn Đức ( AFF Decor)', department = 'AFF Decor' WHERE staff_name = 'Đức decor n8n'").run();
    db.prepare("UPDATE posts SET staff_name = 'Mai Văn Đức ( AFF Decor)' WHERE staff_name = 'Đức decor n8n'").run();

    db.prepare("DELETE FROM staff WHERE name IN ('Đức n8n Fitness', 'Đức decor n8n')").run();
  } catch (e) {
    console.error('Migration staff error:', e);
  }

  // Seed active staff accounts
  const insertStaffInitial = db.prepare("INSERT OR IGNORE INTO staff (name, code, role, password, department) VALUES (?, ?, 'staff', '123456', ?)");
  insertStaffInitial.run('Mai Văn Đức ( AFF Fitness)', 'NV_DUC_FITNESS', 'AFF Fitness');
  insertStaffInitial.run('Mai Văn Đức ( AFF Decor)', 'NV_DUC_DECOR', 'AFF Decor');
  insertStaffInitial.run('Trần Đông Ban', 'NV_BAN', 'Affiftfy');
  insertStaffInitial.run('Nguyễn Thị Kim Ngọc', 'NV_NGOC', 'Affiftfy');
  insertStaffInitial.run('Nguyễn Thị Cẩm Thuý', 'NV_THUY', 'Mobile App');
  insertStaffInitial.run('Đặng Thị Hoài Na', 'NV_NA', 'Affiliate Amazon');
  insertStaffInitial.run('Nguyễn Thị Linh', 'NV_LINH', 'BM: AVE Global 1.1');
  insertStaffInitial.run('Hồ Phi Anh', 'NV_PHIANH', 'BM: AVE Global 3.1');
  insertStaffInitial.run('Đỗ Thị Sao', 'NV_SAO', 'BM: AVE Global 3.3');
  insertStaffInitial.run('Phạm Thị Thanh Nga', 'NV_NGA', 'BM: AVE Global 1.1');
  insertStaffInitial.run('Châu Thị Anh Thư', 'NV_THU', 'BM: AVE Global 1.1');
  insertStaffInitial.run('Nguyễn Thị Thương', 'NV_THUONG', 'BM: AVE Global 3.1');
  insertStaffInitial.run('Bùi Thị Trúc Phương', 'NV_PHUONG', 'BM: AVE Global 1.2');
  insertStaffInitial.run('Trương Thị Anh Nhung', 'NV_NHUNG', 'BM: AVE Global 2.1');
  insertStaffInitial.run('Trần Thị Thuý Vy', 'NV_VY', 'BM: AVE Global 2.1');
  insertStaffInitial.run('Nguyễn Anh Tú', 'NV_TU', 'BM: AVE Global 2.1');
  insertStaffInitial.run('Lê Đình Vinh', 'NV_VINH', 'BM: AVE Global 5.5');
  insertStaffInitial.run('Trần Quang Quốc Đạt', 'NV_DAT', 'BM: AVE Global 1.5');

  // Default API Key setting if not exists
  const existingKey = db.prepare("SELECT value FROM app_settings WHERE key = 'api_key'").get();
  if (!existingKey) {
    db.prepare("INSERT INTO app_settings (key, value) VALUES ('api_key', 'crm_karma_secret_token_2026')").run();
  }

  // Seed sample data if empty
  seedSampleData();

  // Clean any old sample/dummy/blank posts
  try {
    db.prepare(`
      DELETE FROM posts 
      WHERE source LIKE '%Seed%' 
         OR source LIKE '%test%' 
         OR message LIKE '%Test post%' 
         OR message IS NULL 
         OR message = '' 
         OR message = '(Không có nội dung văn bản)'
    `).run();
  } catch (e) {}

  // Clean Chưa phân bổ from staff table
  try {
    db.prepare("DELETE FROM staff WHERE name IN ('Chưa phân bổ', 'Unassigned')").run();
  } catch (e) {}
}

function seedSampleData() {
  const samplePages = [
    { name: "Oriental-Inspired Home Decor", page_id: "105542329243433", bm: "AVE Global 5.1", workflow: "n8n decor 1", status: "Active", staff: "Mai Văn Đức ( AFF Decor)", topic: "KOC review gia dụng" },
    { name: "Entryway Emporium", page_id: "321776644349815", bm: "AVE Global 5.1", workflow: "n8n decor 2", status: "Active", staff: "Mai Văn Đức ( AFF Decor)", topic: "KOC review gia dụng" },
    { name: "TechExpertise Hub", page_id: "201515329711126", bm: "AVE Global 5.1", workflow: "n8n decor 3", status: "Active", staff: "Mai Văn Đức ( AFF Decor)", topic: "KOC review gia dụng" },
    { name: "Home Innovations", page_id: "351944711341364", bm: "AVE Global 5.1", workflow: "n8n decor 4", status: "Active", staff: "Mai Văn Đức ( AFF Decor)", topic: "KOC review gia dụng" },
    { name: "Rustic Kitchen Spot", page_id: "213806318473811", bm: "AVE Global 5.1", workflow: "n8n decor 5", status: "Active", staff: "Mai Văn Đức ( AFF Decor)", topic: "KOC review gia dụng" },
    { name: "Home Essentials Emporium", page_id: "284558068082200", bm: "AVE Global 5.1", workflow: "n8n decor 11", status: "Active", staff: "Mai Văn Đức ( AFF Decor)", topic: "KOC review decor" },
    { name: "Home Feast Decor", page_id: "313945568464760", bm: "AVE Global 5.1", workflow: "n8n decor 12", status: "Active", staff: "Mai Văn Đức ( AFF Decor)", topic: "KOC review decor" },
    { name: "Kingdom Kraze", page_id: "339850282535287", bm: "AVE Global 5.1", workflow: "n8n decor 13", status: "Active", staff: "Mai Văn Đức ( AFF Decor)", topic: "KOC review decor" },
    { name: "Desert-Inspired Home Design", page_id: "100311526445290", bm: "AVE Global 1.5", workflow: "n8n decor 14", status: "Active", staff: "Mai Văn Đức ( AFF Decor)", topic: "KOC review decor" },
    { name: "Intérieur Chic", page_id: "266409643219582", bm: "AVE Tool 2.7", workflow: "n8n decor 21", status: "Active", staff: "Mai Văn Đức ( AFF Decor)", topic: "Top trend review" },
    { name: "Ambiance Apaisante", page_id: "241482175722896", bm: "AVE Tool 2.7", workflow: "n8n decor 22", status: "Active", staff: "Mai Văn Đức ( AFF Decor)", topic: "Top trend review" },
    { name: "Atmosphère Harmonieuse", page_id: "285486621304856", bm: "AVE Tool 2.7", workflow: "n8n decor 23", status: "Active", staff: "Mai Văn Đức ( AFF Decor)", topic: "Top trend review" },
    { name: "Urban Oasis", page_id: "116012434869808", bm: "AVE Global 1.5", workflow: "n8n fitness 1", status: "Active", staff: "Mai Văn Đức ( AFF Fitness)", topic: "Fitness & Sức khỏe" },
    { name: "DIY Decor Hacks", page_id: "105748409222743", bm: "AVE Global 5.1", workflow: "n8n decor 8", status: "Active", staff: "Trần Đông Ban", topic: "KOC review decor" },
    { name: "Retro Modern Furniture", page_id: "106175722516003", bm: "AVE Tool 1.2", workflow: "n8n decor 17", status: "Active", staff: "Nguyễn Thị Kim Ngọc", topic: "KOC review gia dụng" }
  ];

  const insertStaff = db.prepare("INSERT OR IGNORE INTO staff (name, department) VALUES (?, ?)");
  const insertMaster = db.prepare(`
    INSERT INTO master_pages (page_name, page_id, staff_name, department, topic, bm, workflow, status, note)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const findPage = db.prepare("SELECT id FROM pages WHERE page_id = ?");
  const updatePage = db.prepare("UPDATE pages SET name = ?, page_url = ?, staff_name = ?, topic = ? WHERE id = ?");
  const insertNewPage = db.prepare("INSERT INTO pages (name, page_id, page_url, category, staff_name, topic) VALUES (?, ?, ?, 'Của tôi', ?, ?)");

  samplePages.forEach(p => {
    insertStaff.run(p.staff, p.bm ? `BM: ${p.bm}` : 'Content Marketing');
    
    db.prepare("DELETE FROM master_pages WHERE page_id = ?").run(p.page_id);
    insertMaster.run(p.name, p.page_id, p.staff, p.bm ? `BM: ${p.bm}` : 'Content Marketing', p.topic, p.bm, p.workflow, p.status, '');
    
    const ex = findPage.get(p.page_id);
    const fbUrl = `https://facebook.com/${p.page_id}`;
    if (ex) {
      updatePage.run(p.name, fbUrl, p.staff, p.topic, ex.id);
    } else {
      insertNewPage.run(p.name, p.page_id, fbUrl, p.staff, p.topic);
    }
  });

  const count = db.prepare("SELECT COUNT(*) as count FROM daily_metrics").get().count;
  if (count === 0) {
    const insertMetric = db.prepare(`
      INSERT OR REPLACE INTO daily_metrics 
      (page_name, report_date, views, posts_per_day, post_count, interactions, engagement_rate, followers, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    // Generate 14 days of realistic sample data for top pages
    const now = new Date();
    for (let i = 13; i >= 0; i--) {
      const d = new Date();
      d.setDate(now.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];

      samplePages.forEach((p, idx) => {
        const baseViews = 5000 + (idx % 4) * 4000 + (14 - i) * 300;
        const views = Math.floor(baseViews + Math.random() * 2000);
        const posts = Number((1.5 + (idx % 3) * 0.8 + Math.random() * 0.5).toFixed(1));
        const inter = Math.floor(views * (0.03 + (idx % 3) * 0.015));
        const er = Number(((inter / views) * 100).toFixed(2));
        const followers = 25000 + idx * 8000 + (14 - i) * 150;
        insertMetric.run(p.name, dateStr, views, posts, Math.round(posts * 7), inter, er, followers, "Sample Seed");
      });
    }
  }

  // Sample webhook log
  db.prepare(`
    INSERT INTO webhook_logs (sender_email, status, record_count, message, raw_payload)
    VALUES (?, ?, ?, ?, ?)
  `).run('maiduc2311@gmail.com', 'SUCCESS', samplePages.length, 'Khởi tạo dữ liệu báo cáo Fanpage Karma mẫu', JSON.stringify({ note: 'Initial Seed Data' }));
}

function seedSamplePosts() {
  const count = db.prepare("SELECT COUNT(*) as count FROM posts").get().count;
  if (count > 0) return;

  const samplePosts = [
    {
      page_name: "Urban Oasis",
      post_id: "1001",
      post_url: "https://facebook.com/urbanoasis/posts/1001",
      message: "Taking it one step at a time to become stronger and healthier. ❤️💪 Progress may be slow, but I'm not giving up. If you have a little bit of time today, try this core workout routine at home!",
      thumbnail_url: "https://images.unsplash.com/photo-1517838277536-f5f99be501cd?w=150&h=150&fit=crop",
      media_type: "video",
      published_at: "2026-08-20 01:57:00",
      likes: 4,
      comments: 0,
      shares: 1,
      interactions: 5,
      interaction_rate: 0.0033,
      reach: 1250,
      interactions_per_impression: 2.7,
      negative_sentiment_share: 0,
      staff_name: "Mai Văn Đức ( AFF Fitness)"
    },
    {
      page_name: "Urban Oasis",
      post_id: "1002",
      post_url: "https://facebook.com/urbanoasis/posts/1002",
      message: "If you're serious about your fitness journey, this little upgrade can make a BIG difference. ✨ These workout gloves help protect your palms and increase grip strength effortlessly.",
      thumbnail_url: "https://images.unsplash.com/photo-1581009146145-b5ef050c2e1e?w=150&h=150&fit=crop",
      media_type: "video",
      published_at: "2026-08-19 18:42:00",
      likes: 0,
      comments: 1,
      shares: 0,
      interactions: 1,
      interaction_rate: 0.00065,
      reach: 454,
      interactions_per_impression: 0.19,
      negative_sentiment_share: 0,
      staff_name: "Mai Văn Đức ( AFF Fitness)"
    },
    {
      page_name: "Retro Modern Furniture",
      post_id: "1003",
      post_url: "https://facebook.com/retromodern/posts/1003",
      message: "Comment \"TOOL\" and I'll send the link directly to your DMs! ✨ Don't forget to save this post for later! 💡 Tired of stripping cheap screws, this 32-in-1 precision driver set solves everything.",
      thumbnail_url: "https://images.unsplash.com/photo-1581783898377-1c85bf937427?w=150&h=150&fit=crop",
      media_type: "image",
      published_at: "2026-08-19 18:30:00",
      likes: 0,
      comments: 0,
      shares: 0,
      interactions: 0,
      interaction_rate: 0,
      reach: 106,
      interactions_per_impression: 0,
      negative_sentiment_share: 0,
      staff_name: "Chưa phân bổ"
    },
    {
      page_name: "Homecrafted",
      post_id: "1004",
      post_url: "https://facebook.com/homecrafted/posts/1004",
      message: "💕 Pink bowls, pink bathroom, pure purrfection! 💖 I just upgraded my kitty's mealtime with these heart-shaped ceramic bowls. Ceramic prevents chin acne and looks so aesthetic!",
      thumbnail_url: "https://images.unsplash.com/photo-1514888286974-6c03e2ca1dba?w=150&h=150&fit=crop",
      media_type: "video",
      published_at: "2026-08-19 17:36:00",
      likes: 0,
      comments: 1,
      shares: 0,
      interactions: 1,
      interaction_rate: 0.0026,
      reach: 180,
      interactions_per_impression: 0.85,
      negative_sentiment_share: 0,
      staff_name: "Nguyễn Văn A"
    },
    {
      page_name: "DIY Decor Hacks",
      post_id: "1005",
      post_url: "https://facebook.com/diydecorhacks/posts/1005",
      message: "💕 Pink bowls, pink bathroom, pure purrfection! 💖 I just upgraded my kitty's mealtime with these heart-shaped ceramic bowls. Your fur babies deserve the prettiest setup!",
      thumbnail_url: "https://images.unsplash.com/photo-1548767797-d8c844163c4c?w=150&h=150&fit=crop",
      media_type: "video",
      published_at: "2026-08-19 17:35:00",
      likes: 0,
      comments: 1,
      shares: 0,
      interactions: 1,
      interaction_rate: 0.0027,
      reach: 103,
      interactions_per_impression: 0.91,
      negative_sentiment_share: 0,
      staff_name: "Nguyễn Văn A"
    },
    {
      page_name: "Home DIY Haven",
      post_id: "1006",
      post_url: "https://facebook.com/homediyhaven/posts/1006",
      message: "✨ The ladder that actually makes you WANT to clean those high shelves? Yep. This folding stepladder is sturdy, has wide anti-slip steps, and folds flat behind any door!",
      thumbnail_url: "https://images.unsplash.com/photo-1513694203232-719a280e022f?w=150&h=150&fit=crop",
      media_type: "image",
      published_at: "2026-08-19 17:06:00",
      likes: 0,
      comments: 1,
      shares: 0,
      interactions: 1,
      interaction_rate: 0.049,
      reach: 12,
      interactions_per_impression: 7.7,
      negative_sentiment_share: 100,
      staff_name: "Trần Thị B"
    },
    {
      page_name: "Retro Modern Furniture",
      post_id: "1007",
      post_url: "https://facebook.com/retromodern/posts/1007",
      message: "Comment \"HOLDER\" and I'll send the link directly to your DMs! ✨ Don't forget to save this post for later! 💡 Tired of losing your TV remotes? Wall mounted acrylic holder is a gamechanger.",
      thumbnail_url: "https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=150&h=150&fit=crop",
      media_type: "video",
      published_at: "2026-08-19 16:30:00",
      likes: 0,
      comments: 0,
      shares: 0,
      interactions: 0,
      interaction_rate: 0,
      reach: 154,
      interactions_per_impression: 0,
      negative_sentiment_share: 0,
      staff_name: "Chưa phân bổ"
    },
    {
      page_name: "Modern Nest Co.",
      post_id: "1008",
      post_url: "https://facebook.com/modernnestco/posts/1008",
      message: "🥞 Say goodbye to lumpy, uneven pancakes! 🥞 This stainless steel batter dispenser makes pouring perfect circles feel effortless. Quick breakfast without the messy countertop spill!",
      thumbnail_url: "https://images.unsplash.com/photo-1506084868230-bb9d95c24759?w=150&h=150&fit=crop",
      media_type: "video",
      published_at: "2026-08-19 16:13:00",
      likes: 1,
      comments: 1,
      shares: 0,
      interactions: 2,
      interaction_rate: 0.078,
      reach: 85,
      interactions_per_impression: 2.35,
      negative_sentiment_share: 0,
      staff_name: "Mai Văn Đức ( AFF Fitness)"
    },
    {
      page_name: "The Chic Kitchen",
      post_id: "1009",
      post_url: "https://facebook.com/thechickitchen/posts/1009",
      message: "🎁 The gift you didn't know you needed until now. ☕ If you know someone who takes their coffee or tea seriously (or you're that person), this thermal electric gooseneck kettle is 10/10.",
      thumbnail_url: "https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?w=150&h=150&fit=crop",
      media_type: "video",
      published_at: "2026-08-19 15:49:00",
      likes: 0,
      comments: 1,
      shares: 0,
      interactions: 1,
      interaction_rate: 0.0059,
      reach: 30,
      interactions_per_impression: 3.1,
      negative_sentiment_share: 0,
      staff_name: "Trần Thị B"
    },
    {
      page_name: "Rare Finds Corner",
      post_id: "1010",
      post_url: "https://facebook.com/rarefindscorner/posts/1010",
      message: "☕ Barista-level coffee at home, anyone? ☕ The gooseneck spout gives you that slow, steady stream that makes pour-over coffee taste 10x richer. Highly recommend!",
      thumbnail_url: "https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=150&h=150&fit=crop",
      media_type: "video",
      published_at: "2026-08-19 15:49:00",
      likes: 0,
      comments: 1,
      shares: 0,
      interactions: 1,
      interaction_rate: 0.021,
      reach: 20,
      interactions_per_impression: 4.5,
      negative_sentiment_share: 0,
      staff_name: "Mai Văn Đức ( AFF Fitness)"
    },
    {
      page_name: "Chill Hack Home",
      post_id: "1011",
      post_url: "https://facebook.com/chillhackhome/posts/1011",
      message: "☕ I just realized my old kettle was ruining my coffee. 😱 Turns out temperature matters way more than I thought! Overheated water makes beans taste burnt. Precision kettle fixed it!",
      thumbnail_url: "https://images.unsplash.com/photo-1521017432531-fbd92d768814?w=150&h=150&fit=crop",
      media_type: "video",
      published_at: "2026-08-19 15:49:00",
      likes: 0,
      comments: 1,
      shares: 0,
      interactions: 1,
      interaction_rate: 0.0096,
      reach: 16,
      interactions_per_impression: 5.9,
      negative_sentiment_share: 0,
      staff_name: "Nguyễn Văn A"
    }
  ];

  const insertPost = db.prepare(`
    INSERT INTO posts 
    (page_name, post_id, post_url, message, thumbnail_url, media_type, published_at, likes, comments, shares, interactions, interaction_rate, reach, interactions_per_impression, negative_sentiment_share, staff_name, source)
    VALUES (@page_name, @post_id, @post_url, @message, @thumbnail_url, @media_type, @published_at, @likes, @comments, @shares, @interactions, @interaction_rate, @reach, @interactions_per_impression, @negative_sentiment_share, @staff_name, @source)
  `);

  const trx = db.transaction((posts) => {
    for (const p of posts) {
      insertPost.run({
        ...p,
        source: 'Fanpage Karma (Seed)'
      });
    }
  });

  trx(samplePosts);
}

initDb();

module.exports = {
  db,
  getApiKey: () => db.prepare("SELECT value FROM app_settings WHERE key = 'api_key'").get()?.value,
  setApiKey: (key) => db.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('api_key', ?)").run(key),
  seedSamplePosts
};

