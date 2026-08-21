const express = require('express');
const cors = require('cors');
const path = require('path');
const os = require('os');
const multer = require('multer');
const xlsx = require('xlsx');
const { parse } = require('csv-parse/sync');
const { db, getApiKey, setApiKey } = require('./db');
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL || 'https://eotcqkgfddvudzcbavaw.supabase.co';
const supabaseKey = process.env.SUPABASE_KEY || 'sb_secret_Z54UkXInHPqAAYZXM02-8A_Ejucg2Tq';
const supabase = createClient(supabaseUrl, supabaseKey);

const app = express();
const PORT = process.env.PORT || 3300;

app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const uploadDir = process.env.VERCEL ? os.tmpdir() : path.join(__dirname, 'uploads/');
const upload = multer({ dest: uploadDir });

// Authentication middleware for Webhook
function authenticateApiKey(req, res, next) {
  const currentKey = getApiKey();
  const authHeader = req.headers['authorization'];
  const queryKey = req.query.apiKey;
  const bodyKey = req.body?.apiKey;

  let providedKey = null;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    providedKey = authHeader.substring(7).trim();
  } else if (queryKey) {
    providedKey = queryKey.trim();
  } else if (bodyKey) {
    providedKey = bodyKey.trim();
  }

  if (!providedKey || providedKey !== currentKey) {
    return res.status(401).json({ success: false, error: 'Unauthorized: Sai API Key hoặc chưa cung cấp Token.' });
  }
  next();
}

// ----------------------------------------------------
// 0. AUTH & USER PROFILES
// ----------------------------------------------------
app.get('/api/auth/users', (req, res) => {
  try {
    const users = db.prepare("SELECT id, name, code, role, department FROM staff WHERE name != 'Chưa phân bổ' AND name != 'Unassigned' ORDER BY role DESC, name ASC").all();
    res.json({ success: true, data: users });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/auth/login', (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !username.trim()) {
      return res.status(400).json({ success: false, error: 'Vui lòng nhập tên đăng nhập / chọn nhân sự.' });
    }
    if (!password) {
      return res.status(400).json({ success: false, error: 'Vui lòng nhập mật khẩu.' });
    }

    const trimmedUser = username.trim();
    const user = db.prepare(`
      SELECT id, name, code, role, department, password 
      FROM staff 
      WHERE LOWER(TRIM(name)) = LOWER(?) OR LOWER(TRIM(code)) = LOWER(?)
    `).get(trimmedUser, trimmedUser);

    if (!user) {
      return res.status(401).json({ success: false, error: 'Tài khoản không tồn tại trong hệ thống.' });
    }

    // Validate password
    const dbPass = user.password || (user.role === 'admin' ? 'Admin@191' : '123456');
    if (password !== dbPass) {
      return res.status(401).json({ success: false, error: 'Mật khẩu không chính xác. Vui lòng kiểm tra lại.' });
    }

    res.json({
      success: true,
      message: 'Đăng nhập thành công!',
      user: {
        id: user.id,
        name: user.name,
        code: user.code,
        role: user.role || 'staff',
        department: user.department || 'Content Marketing'
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/auth/change-password', (req, res) => {
  try {
    const { username, oldPassword, newPassword, confirmPassword } = req.body;
    if (!username || !newPassword) {
      return res.status(400).json({ success: false, error: 'Vui lòng điền đầy đủ thông tin mật khẩu.' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ success: false, error: 'Mật khẩu mới phải có ít nhất 6 ký tự.' });
    }

    if (confirmPassword && newPassword !== confirmPassword) {
      return res.status(400).json({ success: false, error: 'Mật khẩu xác nhận không trùng khớp.' });
    }

    const trimmedUser = username.trim();
    const user = db.prepare(`
      SELECT id, name, role, password 
      FROM staff 
      WHERE LOWER(TRIM(name)) = LOWER(?) OR LOWER(TRIM(code)) = LOWER(?)
    `).get(trimmedUser, trimmedUser);

    if (!user) return res.status(404).json({ success: false, error: 'Không tìm thấy tài khoản.' });

    const currentPass = user.password || (user.role === 'admin' ? 'Admin@191' : '123456');
    if (oldPassword !== currentPass) {
      return res.status(400).json({ success: false, error: 'Mật khẩu hiện tại không chính xác.' });
    }

    db.prepare('UPDATE staff SET password = ? WHERE id = ?').run(newPassword, user.id);
    res.json({ success: true, message: 'Đổi mật khẩu thành công! Vui lòng ghi nhớ mật khẩu mới.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ----------------------------------------------------
// 1. OVERVIEW & ANALYTICS APIs
// ----------------------------------------------------
app.get('/api/overview', (req, res) => {
  try {
    const { days = 14, staff_name, report_date, start_date, end_date } = req.query;
    const isStaffFiltered = staff_name && staff_name !== 'all' && staff_name !== 'Admin';

    // Total pages (combining pages and master_pages)
    let totalPagesQuery = `
      WITH all_p AS (
        SELECT p.name, COALESCE(NULLIF(p.staff_name, 'Chưa phân bổ'), mp.staff_name, 'Chưa phân bổ') as staff_name FROM pages p
        LEFT JOIN master_pages mp ON (p.page_id IS NOT NULL AND p.page_id != '' AND mp.page_id = p.page_id) OR LOWER(TRIM(mp.page_name)) = LOWER(TRIM(p.name))
        UNION
        SELECT m.page_name as name, m.staff_name FROM master_pages m
      )
      SELECT COUNT(*) as count FROM all_p
    `;
    const totalPagesParams = [];
    if (isStaffFiltered) {
      totalPagesQuery += ' WHERE staff_name = ?';
      totalPagesParams.push(staff_name);
    }
    const totalPages = db.prepare(totalPagesQuery).get(...totalPagesParams).count;

    // Available dates
    const availableDates = db.prepare('SELECT DISTINCT report_date FROM daily_metrics ORDER BY report_date DESC LIMIT 60').all().map(r => r.report_date);
    const defaultDate = availableDates[0] || (db.prepare('SELECT MAX(report_date) as maxDate FROM daily_metrics').get()?.maxDate) || new Date().toISOString().split('T')[0];

    let startDate = start_date || report_date || defaultDate;
    let endDate = end_date || report_date || defaultDate;
    if (startDate > endDate) {
      const tmp = startDate; startDate = endDate; endDate = tmp;
    }

    // Stats across date range
    let statsQuery = `
      SELECT 
        SUM(m.views) as total_views,
        AVG(m.posts_per_day) as avg_posts_per_day,
        SUM(m.post_count) as total_posts,
        SUM(m.interactions) as total_interactions,
        AVG(m.engagement_rate) as avg_engagement_rate
      FROM daily_metrics m
    `;
    const statsParams = [];
    if (isStaffFiltered) {
      statsQuery += ` JOIN (
        SELECT p.name, COALESCE(NULLIF(p.staff_name, 'Chưa phân bổ'), mp.staff_name, 'Chưa phân bổ') as staff_name FROM pages p
        LEFT JOIN master_pages mp ON (p.page_id IS NOT NULL AND p.page_id != '' AND mp.page_id = p.page_id) OR LOWER(TRIM(mp.page_name)) = LOWER(TRIM(p.name))
        UNION
        SELECT m.page_name as name, m.staff_name FROM master_pages m
      ) p ON m.page_name = p.name WHERE m.report_date >= ? AND m.report_date <= ? AND p.staff_name = ?`;
      statsParams.push(startDate, endDate, staff_name);
    } else {
      statsQuery += ' WHERE m.report_date >= ? AND m.report_date <= ?';
      statsParams.push(startDate, endDate);
    }
    const rangeStats = db.prepare(statsQuery).get(...statsParams);

    // Top performing page across date range
    let topPageQuery = `
      SELECT m.page_name, SUM(m.views) as views, AVG(m.posts_per_day) as posts_per_day, AVG(m.engagement_rate) as engagement_rate 
      FROM daily_metrics m
    `;
    const topPageParams = [];
    if (isStaffFiltered) {
      topPageQuery += ` JOIN (
        SELECT p.name, COALESCE(NULLIF(p.staff_name, 'Chưa phân bổ'), mp.staff_name, 'Chưa phân bổ') as staff_name FROM pages p
        LEFT JOIN master_pages mp ON (p.page_id IS NOT NULL AND p.page_id != '' AND mp.page_id = p.page_id) OR LOWER(TRIM(mp.page_name)) = LOWER(TRIM(p.name))
        UNION
        SELECT m.page_name as name, m.staff_name FROM master_pages m
      ) p ON m.page_name = p.name WHERE m.report_date >= ? AND m.report_date <= ? AND p.staff_name = ?`;
      topPageParams.push(startDate, endDate, staff_name);
    } else {
      topPageQuery += ' WHERE m.report_date >= ? AND m.report_date <= ?';
      topPageParams.push(startDate, endDate);
    }
    topPageQuery += ' GROUP BY m.page_name ORDER BY views DESC LIMIT 1';
    const topPage = db.prepare(topPageQuery).get(...topPageParams);

    // Aggregate trends by date across date range
    let trendQuery = `
      SELECT 
        m.report_date,
        SUM(m.views) as total_views,
        AVG(m.posts_per_day) as avg_posts_per_day,
        SUM(m.post_count) as total_posts,
        SUM(m.interactions) as total_interactions
      FROM daily_metrics m
    `;
    const trendParams = [];
    if (isStaffFiltered) {
      trendQuery += ` JOIN (
        SELECT p.name, COALESCE(NULLIF(p.staff_name, 'Chưa phân bổ'), mp.staff_name, 'Chưa phân bổ') as staff_name FROM pages p
        LEFT JOIN master_pages mp ON (p.page_id IS NOT NULL AND p.page_id != '' AND mp.page_id = p.page_id) OR LOWER(TRIM(mp.page_name)) = LOWER(TRIM(p.name))
        UNION
        SELECT m.page_name as name, m.staff_name FROM master_pages m
      ) p ON m.page_name = p.name WHERE m.report_date >= ? AND m.report_date <= ? AND p.staff_name = ? GROUP BY m.report_date ORDER BY m.report_date ASC`;
      trendParams.push(startDate, endDate, staff_name);
    } else {
      trendQuery += ' WHERE m.report_date >= ? AND m.report_date <= ? GROUP BY m.report_date ORDER BY m.report_date ASC';
      trendParams.push(startDate, endDate);
    }
    const aggregatedTrend = db.prepare(trendQuery).all(...trendParams);

    // Snapshot comparison by page across date range
    let compQuery = `
      SELECT 
        m.page_name,
        COALESCE(p.category, 'Của tôi') as category,
        COALESCE(p.page_url, CASE WHEN COALESCE(m.page_id, p.page_id) IS NOT NULL THEN 'https://facebook.com/' || COALESCE(m.page_id, p.page_id) ELSE '' END) as page_url,
        COALESCE(m.page_id, p.page_id) as page_id,
        COALESCE(NULLIF(p.avatar_url, ''), CASE WHEN COALESCE(m.page_id, p.page_id) IS NOT NULL AND COALESCE(m.page_id, p.page_id) != '' THEN 'https://graph.facebook.com/' || COALESCE(m.page_id, p.page_id) || '/picture?type=square' ELSE NULL END) as avatar_url,
        COALESCE(NULLIF(p.staff_name, 'Chưa phân bổ'), mp.staff_name, 'Chưa phân bổ') as staff_name,
        SUM(m.views) as views,
        AVG(m.posts_per_day) as posts_per_day,
        SUM(m.post_count) as post_count,
        SUM(m.interactions) as interactions,
        AVG(m.engagement_rate) as engagement_rate,
        MAX(m.followers) as followers,
        MAX(m.report_date) as report_date
      FROM daily_metrics m
      LEFT JOIN pages p ON (m.page_id IS NOT NULL AND m.page_id != '' AND p.page_id = m.page_id) OR ((m.page_id IS NULL OR m.page_id = '') AND LOWER(TRIM(p.name)) = LOWER(TRIM(m.page_name)))
      LEFT JOIN master_pages mp ON (m.page_id IS NOT NULL AND m.page_id != '' AND mp.page_id = m.page_id) OR ((m.page_id IS NULL OR m.page_id = '') AND LOWER(TRIM(mp.page_name)) = LOWER(TRIM(m.page_name)))
      WHERE m.report_date >= ? AND m.report_date <= ?
    `;
    const compParams = [startDate, endDate];
    if (isStaffFiltered) {
      compQuery += ' AND (p.staff_name = ? OR mp.staff_name = ?)';
      compParams.push(staff_name, staff_name);
    }
    compQuery += ' GROUP BY COALESCE(m.page_id, m.page_name) ORDER BY views DESC LIMIT 200';
    const pageComparison = db.prepare(compQuery).all(...compParams);

    // Top Growth (comparing current range to previous date)
    const prevDateQuery = 'SELECT MAX(report_date) as prevDate FROM daily_metrics WHERE report_date < ?';
    const prevDateRow = db.prepare(prevDateQuery).get(startDate);
    const prevDate = prevDateRow?.prevDate;

    let growthQuery = `
      SELECT 
        curr.page_name,
        SUM(curr.views) as current_views,
        COALESCE(prev.views, 0) as prev_views,
        SUM(curr.views) - COALESCE(prev.views, 0) as views_growth,
        CASE 
          WHEN prev.views IS NULL OR prev.views = 0 THEN 100.0
          ELSE ROUND(((SUM(curr.views) - prev.views) * 100.0 / prev.views), 1)
        END as growth_rate
      FROM daily_metrics curr
      LEFT JOIN daily_metrics prev ON curr.page_name = prev.page_name AND prev.report_date = ?
      JOIN pages p ON curr.page_name = p.name
      WHERE curr.report_date >= ? AND curr.report_date <= ?
    `;
    const growthParams = [prevDate || '', startDate, endDate];
    if (isStaffFiltered) {
      growthQuery += ' AND p.staff_name = ?';
      growthParams.push(staff_name);
    }
    growthQuery += ' GROUP BY curr.page_name ORDER BY views_growth DESC LIMIT 5';
    const topGrowth = db.prepare(growthQuery).all(...growthParams);

    res.json({
      success: true,
      data: {
        startDate,
        endDate,
        latestDate: endDate,
        availableDates,
        totalPages,
        staffName: isStaffFiltered ? staff_name : 'Toàn bộ',
        summary: {
          totalViews: rangeStats?.total_views || 0,
          avgPostsPerDay: Number((rangeStats?.avg_posts_per_day || 0).toFixed(2)),
          totalPosts: rangeStats?.total_posts || 0,
          totalInteractions: rangeStats?.total_interactions || 0,
          avgEngagementRate: Number((rangeStats?.avg_engagement_rate || 0).toFixed(2)),
          topPage: topPage || null
        },
        aggregatedTrend,
        pageComparison,
        topGrowth
      }
    });
  } catch (err) {
    console.error('Error in /api/overview:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ----------------------------------------------------
// 2. PAGES MANAGEMENT APIs
// ----------------------------------------------------
app.get('/api/pages', (req, res) => {
  try {
    const { staff_name, report_date, start_date, end_date } = req.query;
    const availableDates = db.prepare('SELECT DISTINCT report_date FROM daily_metrics ORDER BY report_date DESC LIMIT 60').all().map(r => r.report_date);
    const defaultDate = availableDates[0] || (db.prepare('SELECT MAX(report_date) as maxDate FROM daily_metrics').get()?.maxDate) || new Date().toISOString().split('T')[0];

    let startDate = start_date || report_date || defaultDate;
    let endDate = end_date || report_date || defaultDate;
    if (startDate > endDate) {
      const tmp = startDate; startDate = endDate; endDate = tmp;
    }

    let query = `
      WITH all_p AS (
        SELECT 
          p.id,
          p.name,
          p.page_id,
          p.page_url,
          p.category,
          p.avatar_url,
          COALESCE(NULLIF(p.staff_name, 'Chưa phân bổ'), mp.staff_name, 'Chưa phân bổ') as staff_name,
          COALESCE(NULLIF(p.topic, 'Chưa phân loại'), mp.topic, 'Chưa phân loại') as topic
        FROM pages p
        LEFT JOIN master_pages mp ON CASE WHEN p.page_id IS NOT NULL AND p.page_id != '' THEN mp.page_id = p.page_id ELSE LOWER(TRIM(mp.page_name)) = LOWER(TRIM(p.name)) END
        
        UNION
        
        SELECT 
          m.id + 100000 as id,
          m.page_name as name,
          m.page_id,
          CASE WHEN m.page_id != '' THEN 'https://facebook.com/' || m.page_id ELSE '' END as page_url,
          'Của tôi' as category,
          NULL as avatar_url,
          m.staff_name,
          m.topic
        FROM master_pages m
        WHERE NOT EXISTS (
          SELECT 1 FROM pages p 
          WHERE CASE WHEN m.page_id IS NOT NULL AND m.page_id != '' THEN p.page_id = m.page_id ELSE LOWER(TRIM(p.name)) = LOWER(TRIM(m.page_name)) END
        )
      )
      SELECT 
        p.*,
        '${endDate}' as selected_report_date,
        (SELECT MAX(report_date) FROM daily_metrics d WHERE CASE WHEN p.page_id IS NOT NULL AND p.page_id != '' THEN d.page_id = p.page_id ELSE LOWER(TRIM(d.page_name)) = LOWER(TRIM(p.name)) END) as latest_report_date,
        COALESCE((SELECT SUM(views) FROM daily_metrics d WHERE (CASE WHEN p.page_id IS NOT NULL AND p.page_id != '' THEN d.page_id = p.page_id ELSE LOWER(TRIM(d.page_name)) = LOWER(TRIM(p.name)) END) AND d.report_date >= ? AND d.report_date <= ?), 0) as latest_views,
        COALESCE((SELECT SUM(post_count) FROM daily_metrics d WHERE (CASE WHEN p.page_id IS NOT NULL AND p.page_id != '' THEN d.page_id = p.page_id ELSE LOWER(TRIM(d.page_name)) = LOWER(TRIM(p.name)) END) AND d.report_date >= ? AND d.report_date <= ?), 0) as latest_posts_per_day,
        COALESCE((SELECT SUM(post_count) FROM daily_metrics d WHERE (CASE WHEN p.page_id IS NOT NULL AND p.page_id != '' THEN d.page_id = p.page_id ELSE LOWER(TRIM(d.page_name)) = LOWER(TRIM(p.name)) END) AND d.report_date >= ? AND d.report_date <= ?), 0) as latest_post_count,
        COALESCE((SELECT AVG(engagement_rate) FROM daily_metrics d WHERE (CASE WHEN p.page_id IS NOT NULL AND p.page_id != '' THEN d.page_id = p.page_id ELSE LOWER(TRIM(d.page_name)) = LOWER(TRIM(p.name)) END) AND d.report_date >= ? AND d.report_date <= ?), 0) as latest_engagement_rate,
        COALESCE((SELECT MAX(followers) FROM daily_metrics d WHERE (CASE WHEN p.page_id IS NOT NULL AND p.page_id != '' THEN d.page_id = p.page_id ELSE LOWER(TRIM(d.page_name)) = LOWER(TRIM(p.name)) END) AND d.report_date >= ? AND d.report_date <= ?), 0) as latest_followers,
        (SELECT COUNT(*) FROM daily_metrics d WHERE CASE WHEN p.page_id IS NOT NULL AND p.page_id != '' THEN d.page_id = p.page_id ELSE LOWER(TRIM(d.page_name)) = LOWER(TRIM(p.name)) END) as total_records
      FROM all_p p
    `;
    const params = [
      startDate, endDate, // views
      startDate, endDate, // posts_per_day
      startDate, endDate, // post_count
      startDate, endDate, // engagement_rate
      startDate, endDate  // followers
    ];
    if (staff_name && staff_name !== 'all' && staff_name !== 'Admin') {
      query += ' WHERE p.staff_name = ?';
      params.push(staff_name);
    }
    query += ' ORDER BY p.id ASC';

    const pages = db.prepare(query).all(...params);
    res.json({ success: true, data: pages, startDate, endDate, targetDate: endDate, availableDates });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/pages', (req, res) => {
  try {
    const { name, category, page_url, staff_name, topic } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, error: 'Tên fanpage không được để trống.' });
    }

    const trimmedName = name.trim();
    const finalTopic = (topic || '').trim() || 'Chưa phân loại';
    const existing = db.prepare('SELECT id FROM pages WHERE name = ?').get(trimmedName);
    if (existing) {
      db.prepare('UPDATE pages SET category = ?, page_url = ?, staff_name = ?, topic = ? WHERE id = ?').run(
        category || 'Của tôi',
        page_url || '',
        staff_name || 'Chưa phân bổ',
        finalTopic,
        existing.id
      );
      return res.json({ success: true, message: 'Đã cập nhật thông tin trang.', id: existing.id });
    }

    const info = db.prepare('INSERT INTO pages (name, category, page_url, staff_name, topic) VALUES (?, ?, ?, ?, ?)').run(
      trimmedName,
      category || 'Của tôi',
      page_url || '',
      staff_name || 'Chưa phân bổ',
      finalTopic
    );

    res.json({ success: true, message: 'Đã thêm fanpage mới.', id: info.lastInsertRowid });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Quick Assign Topic to a Page
app.post('/api/pages/topic', (req, res) => {
  try {
    const { page_name, topic } = req.body;
    if (!page_name) return res.status(400).json({ success: false, error: 'Thiếu tên page.' });

    const finalTopic = (topic || '').trim() || 'Chưa phân loại';
    db.prepare('UPDATE pages SET topic = ? WHERE name = ?').run(finalTopic, page_name);
    db.prepare('UPDATE master_pages SET topic = ? WHERE page_name = ?').run(finalTopic, page_name);

    res.json({ success: true, message: `Đã cập nhật chủ đề "${finalTopic}" cho trang "${page_name}".` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Quick Assign Staff to a Page
app.post('/api/pages/assign', (req, res) => {
  try {
    const { page_name, staff_name } = req.body;
    if (!page_name) return res.status(400).json({ success: false, error: 'Thiếu tên page.' });

    const staff = (staff_name || '').trim() || 'Chưa phân bổ';
    db.prepare('UPDATE pages SET staff_name = ? WHERE name = ?').run(staff, page_name);

    // Also update or insert in master_pages
    const page = db.prepare('SELECT page_id, topic FROM pages WHERE name = ?').get(page_name);
    if (staff !== 'Chưa phân bổ') {
      const existingMaster = db.prepare('SELECT id FROM master_pages WHERE page_name = ?').get(page_name);
      if (existingMaster) {
        db.prepare('UPDATE master_pages SET staff_name = ? WHERE id = ?').run(staff, existingMaster.id);
      } else {
        db.prepare(`
          INSERT INTO master_pages (page_name, page_id, staff_name, topic)
          VALUES (?, ?, ?, ?)
        `).run(page_name, page?.page_id || '', staff, page?.topic || 'Chưa phân loại');
      }

      // Auto ensure staff exists
      db.prepare('INSERT OR IGNORE INTO staff (name) VALUES (?)').run(staff);
    }

    res.json({ success: true, message: `Đã gán "${page_name}" cho nhân sự "${staff}".` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/pages/:id', (req, res) => {
  try {
    const page = db.prepare('SELECT name FROM pages WHERE id = ?').get(req.params.id);
    if (!page) {
      return res.status(404).json({ success: false, error: 'Không tìm thấy trang.' });
    }
    db.prepare('DELETE FROM daily_metrics WHERE page_name = ?').run(page.name);
    db.prepare('DELETE FROM pages WHERE id = ?').run(req.params.id);

    res.json({ success: true, message: `Đã xóa trang ${page.name} và toàn bộ chỉ số liên quan.` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ----------------------------------------------------
// 2.1 STAFF & MASTER ASSIGNMENT APIs
// ----------------------------------------------------
// Helper to cross reference page against master_pages
function findStaffForPage(pageName, pageId) {
  if (pageId) {
    const byId = db.prepare('SELECT staff_name FROM master_pages WHERE page_id = ?').get(String(pageId).trim());
    if (byId && byId.staff_name) return byId.staff_name;
  }
  if (pageName) {
    const byName = db.prepare('SELECT staff_name FROM master_pages WHERE LOWER(TRIM(page_name)) = LOWER(TRIM(?))').get(pageName);
    if (byName && byName.staff_name) return byName.staff_name;
  }
  return null;
}

function findTopicForPage(pageName, pageId) {
  if (pageId) {
    const byId = db.prepare('SELECT topic FROM master_pages WHERE page_id = ?').get(String(pageId).trim());
    if (byId && byId.topic && byId.topic !== 'Chưa phân loại') return byId.topic;
  }
  if (pageName) {
    const byName = db.prepare('SELECT topic FROM master_pages WHERE LOWER(TRIM(page_name)) = LOWER(TRIM(?))').get(pageName);
    if (byName && byName.topic && byName.topic !== 'Chưa phân loại') return byName.topic;
  }
  return null;
}

// Get Staff list with aggregated performance KPI
app.get('/api/staff', (req, res) => {
  try {
    const { report_date, start_date, end_date } = req.query;
    const availableDates = db.prepare('SELECT DISTINCT report_date FROM daily_metrics ORDER BY report_date DESC LIMIT 60').all().map(r => r.report_date);
    const defaultDate = availableDates[0] || (db.prepare('SELECT MAX(report_date) as maxDate FROM daily_metrics').get()?.maxDate) || new Date().toISOString().split('T')[0];

    let startDate = start_date || report_date || defaultDate;
    let endDate = end_date || report_date || defaultDate;
    if (startDate > endDate) {
      const tmp = startDate; startDate = endDate; endDate = tmp;
    }

    const staffList = db.prepare(`
      SELECT 
        s.*,
        (
          SELECT COUNT(DISTINCT m.id) 
          FROM master_pages m 
          WHERE m.staff_name = s.name
        ) as master_pages_count,
        (
          SELECT COUNT(DISTINCT p.id) 
          FROM pages p 
          WHERE p.staff_name = s.name
        ) as pages_table_count,
        MAX(
          (SELECT COUNT(DISTINCT m.id) FROM master_pages m WHERE m.staff_name = s.name),
          (SELECT COUNT(DISTINCT p.id) FROM pages p WHERE p.staff_name = s.name)
        ) as total_pages_assigned,
        (
          SELECT COUNT(DISTINCT p.id) 
          FROM pages p 
          JOIN daily_metrics dm ON dm.page_name = p.name
          WHERE p.staff_name = s.name AND dm.report_date >= ? AND dm.report_date <= ?
        ) as reported_pages_count,
        (
          SELECT COUNT(DISTINCT m.id) 
          FROM master_pages m 
          WHERE m.staff_name = s.name 
          AND (
            m.bm LIKE '%n8n%' 
            OR m.workflow LIKE '%n8n%' 
            OR m.note LIKE '%n8n%'
          )
        ) as n8n_pages_count,
        (
          SELECT COUNT(DISTINCT m.id)
          FROM master_pages m
          WHERE m.staff_name = s.name
          AND (m.status IS NULL OR m.status = '' OR m.status = 'Chưa nạp' OR m.status = 'Pending')
        ) as no_data_pages_count,
        (
          SELECT COUNT(DISTINCT m.id)
          FROM master_pages m
          WHERE m.staff_name = s.name
          AND LOWER(m.status) LIKE '%lỗi%'
        ) as error_pages_count,
        COALESCE((
          SELECT SUM(m.views) 
          FROM daily_metrics m 
          JOIN pages p ON m.page_name = p.name 
          WHERE p.staff_name = s.name 
          AND m.report_date >= ? AND m.report_date <= ?
        ), 0) as total_views_latest,
        COALESCE((
          SELECT AVG(m.posts_per_day) 
          FROM daily_metrics m 
          JOIN pages p ON m.page_name = p.name 
          WHERE p.staff_name = s.name 
          AND m.report_date >= ? AND m.report_date <= ?
        ), 0) as avg_posts_per_day,
        COALESCE((
          SELECT AVG(m.engagement_rate) 
          FROM daily_metrics m 
          JOIN pages p ON m.page_name = p.name 
          WHERE p.staff_name = s.name 
          AND m.report_date >= ? AND m.report_date <= ?
        ), 0) as avg_engagement_rate
      FROM staff s
      WHERE s.name != 'Chưa phân bổ' AND s.name != 'Unassigned'
      ORDER BY total_views_latest DESC, total_pages_assigned DESC, s.id ASC
    `).all(startDate, endDate, startDate, endDate, startDate, endDate, startDate, endDate);

    // Count unassigned pages
    const unassignedCount = db.prepare("SELECT COUNT(*) as count FROM pages WHERE staff_name IS NULL OR staff_name = '' OR staff_name = 'Chưa phân bổ'").get().count;

    res.json({ success: true, data: staffList, unassignedCount, startDate, endDate, targetDate: endDate, availableDates });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/staff', (req, res) => {
  try {
    const { name, department, code } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, error: 'Tên nhân sự không được để trống.' });
    }
    const trimmed = name.trim();
    const info = db.prepare('INSERT OR REPLACE INTO staff (name, department, code) VALUES (?, ?, ?)').run(
      trimmed,
      department || 'Content Marketing',
      code || ''
    );
    res.json({ success: true, message: `Đã lưu nhân sự "${trimmed}".`, id: info.lastInsertRowid });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/staff/:id', (req, res) => {
  try {
    const staff = db.prepare('SELECT name FROM staff WHERE id = ?').get(req.params.id);
    if (staff) {
      db.prepare("UPDATE pages SET staff_name = 'Chưa phân bổ' WHERE staff_name = ?").run(staff.name);
      db.prepare('DELETE FROM master_pages WHERE staff_name = ?').run(staff.name);
      db.prepare('DELETE FROM staff WHERE id = ?').run(req.params.id);
    }
    res.json({ success: true, message: 'Đã xóa nhân sự.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Master Pages CRUD
app.get('/api/master-pages', (req, res) => {
  try {
    const { staff_name } = req.query;
    let query = `
      SELECT 
        m.*,
        (
          SELECT avatar_url FROM pages p 
          WHERE (m.page_id IS NOT NULL AND m.page_id != '' AND p.page_id = m.page_id)
             OR (p.name = m.page_name)
          LIMIT 1
        ) as avatar_url,
        (SELECT views FROM daily_metrics WHERE page_name = m.page_name ORDER BY report_date DESC LIMIT 1) as latest_views,
        (SELECT posts_per_day FROM daily_metrics WHERE page_name = m.page_name ORDER BY report_date DESC LIMIT 1) as latest_posts_per_day,
        (SELECT MAX(report_date) FROM daily_metrics WHERE page_name = m.page_name) as latest_report_date,
        CASE WHEN (SELECT COUNT(*) FROM daily_metrics WHERE page_name = m.page_name) > 0 THEN 'Đã đồng bộ' ELSE 'Chờ báo cáo' END as sync_status
      FROM master_pages m
    `;
    const params = [];
    if (staff_name && staff_name !== 'all' && staff_name !== 'Admin') {
      query += ' WHERE m.staff_name = ?';
      params.push(staff_name);
    }
    query += ' ORDER BY m.id DESC';

    const list = db.prepare(query).all(...params);
    res.json({ success: true, data: list });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/master-pages', (req, res) => {
  try {
    const { page_name, page_id, staff_name, department, topic, bm, workflow, status, note } = req.body;
    if (!page_name || !page_name.trim()) {
      return res.status(400).json({ success: false, error: 'Tên fanpage không được để trống.' });
    }
    if (!staff_name || !staff_name.trim()) {
      return res.status(400).json({ success: false, error: 'Cần chọn hoặc nhập tên nhân sự.' });
    }

    const trimmedPage = page_name.trim();
    const trimmedStaff = staff_name.trim();
    const trimmedId = (page_id || '').trim();
    const trimmedTopic = (topic || '').trim() || 'Chưa phân loại';
    const pageUrl = trimmedId ? `https://facebook.com/${trimmedId}` : '';

    // Delete existing duplicate assignment if any by page_id or page_name
    if (trimmedId) {
      db.prepare('DELETE FROM master_pages WHERE page_id = ?').run(trimmedId);
    } else {
      db.prepare('DELETE FROM master_pages WHERE page_name = ?').run(trimmedPage);
    }

    // Insert into master_pages
    db.prepare(`
      INSERT INTO master_pages (page_name, page_id, staff_name, department, topic, bm, workflow, status, note)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(trimmedPage, trimmedId, trimmedStaff, department || 'Content Marketing', trimmedTopic, bm || '', workflow || '', status || 'Active', note || '');

    // Ensure staff exists in staff table
    if (trimmedStaff && trimmedStaff !== 'Chưa phân bổ' && trimmedStaff !== 'Unassigned') {
      db.prepare('INSERT OR IGNORE INTO staff (name, department) VALUES (?, ?)').run(trimmedStaff, department || 'Content Marketing');
    }

    // Auto sync to pages table so it shows on Dashboard/Pages table
    const existingPage = db.prepare("SELECT id FROM pages WHERE (page_id IS NOT NULL AND page_id != '' AND page_id = ?) OR LOWER(TRIM(name)) = LOWER(TRIM(?))").get(trimmedId, trimmedPage);
    if (existingPage) {
      db.prepare("UPDATE pages SET staff_name = ?, topic = ?, page_id = CASE WHEN ? != '' THEN ? ELSE page_id END, page_url = CASE WHEN ? != '' THEN ? ELSE page_url END WHERE id = ?").run(
        trimmedStaff,
        trimmedTopic,
        trimmedId, trimmedId,
        pageUrl, pageUrl,
        existingPage.id
      );
    } else {
      db.prepare('INSERT INTO pages (name, page_id, page_url, staff_name, topic) VALUES (?, ?, ?, ?, ?)').run(
        trimmedPage,
        trimmedId,
        pageUrl,
        trimmedStaff,
        trimmedTopic
      );
    }

    res.json({ success: true, message: `Đã phân bổ "${trimmedPage}" cho nhân sự "${trimmedStaff}" (Chủ đề: ${trimmedTopic}).` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/master-pages/:id', (req, res) => {
  try {
    const item = db.prepare('SELECT page_name, page_id FROM master_pages WHERE id = ?').get(req.params.id);
    if (item) {
      db.prepare('DELETE FROM master_pages WHERE id = ?').run(req.params.id);
    }
    res.json({ success: true, message: 'Đã xóa phân bổ gốc.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Import Master List from Excel / CSV file
app.post('/api/master-pages/import', upload.single('file'), (req, res) => {
  const fs = require('fs');
  const filePath = req.file?.path;
  try {
    if (!req.file) return res.status(400).json({ success: false, error: 'Chưa chọn file.' });

    let rows = [];
    const originalName = req.file.originalname.toLowerCase();

    if (originalName.endsWith('.csv')) {
      let content = fs.readFileSync(filePath, 'utf-8');
      if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);
      
      const lines = content.split(/\r?\n/);
      // Auto find first non-empty line with actual text (skipping ;;;;; or blank lines)
      let headerIndex = 0;
      for (let i = 0; i < lines.length; i++) {
        const clean = lines[i].replace(/[;\,\t\s]/g, '').trim();
        if (clean.length > 0) {
          headerIndex = i;
          break;
        }
      }

      const cleanContent = lines.slice(headerIndex).join('\n');
      const firstLine = lines[headerIndex] || '';
      const delimiter = firstLine.includes(';') ? ';' : (firstLine.includes('\t') ? '\t' : ',');

      rows = parse(cleanContent, {
        columns: true,
        delimiter,
        skip_empty_lines: true,
        trim: true,
        relax_quotes: true,
        relax_column_count: true
      });
    } else {
      const workbook = xlsx.readFile(filePath);
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      rows = xlsx.utils.sheet_to_json(sheet, { defval: '' });
    }

    const insertStaff = db.prepare('INSERT OR IGNORE INTO staff (name, department) VALUES (?, ?)');
    const deleteOldMasterById = db.prepare("DELETE FROM master_pages WHERE page_id = ? AND page_id != ''");
    const insertMaster = db.prepare(`
      INSERT INTO master_pages (page_name, page_id, staff_name, department, topic, bm, workflow, status, note)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const findByPageId = db.prepare("SELECT id FROM pages WHERE page_id IS NOT NULL AND page_id != '' AND page_id = ?");
    const findByName = db.prepare("SELECT id FROM pages WHERE name = ? AND (page_id IS NULL OR page_id = '')");
    const updatePageStaff = db.prepare("UPDATE pages SET name = ?, staff_name = ?, topic = ?, page_url = CASE WHEN ? != '' THEN ? ELSE page_url END WHERE id = ?");
    const insertNewPage = db.prepare("INSERT INTO pages (name, page_id, page_url, staff_name, topic) VALUES (?, ?, ?, ?, ?)");

    const uploaderStaff = (req.query.staff_name || req.body?.staff_name || '').trim();
    const isStaffUploader = uploaderStaff && uploaderStaff !== 'Admin';

    let lastKnownStaff = isStaffUploader ? uploaderStaff : 'Chưa phân bổ';
    let count = 0;

    const trx = db.transaction((items) => {
      for (const r of items) {
        const keys = Object.keys(r);
        const findVal = (candidates) => {
          for (const k of keys) {
            const cleanK = k.toLowerCase().replace(/[\s_\-\.\/\(\)\[\]\%]/g, '');
            for (const c of candidates) {
              if (cleanK === c || cleanK.includes(c)) return r[k];
            }
          }
          return '';
        };

        const pageName = String(findVal(['tênpage', 'têntrang', 'page', 'fanpage', 'profile', 'name'])).trim();
        const pageId = String(findVal(['profileid', 'profile-id', 'idpage', 'pageid', 'id'])).trim();
        let parsedStaff = String(findVal(['nhânsự', 'nhansu', 'staff', 'ngườiphụtrách', 'owner', 'nguoiphutrach', 'nv'])).trim();
        const bm = String(findVal(['bm', 'businessmanager'])).trim();
        const workflow = String(findVal(['workflow', 'quytrình'])).trim();
        const status = String(findVal(['trạngthái', 'trangthái', 'status'])).trim() || 'Active';
        const topic = String(findVal(['chủđề', 'chủde', 'chude', 'topic', 'theme', 'niche', 'ngành', 'lĩnhvực'])).trim() || 'Chưa phân loại';

        let staffName = '';
        if (isStaffUploader) {
          // If staff imports their list, automatically assign all pages to themselves
          staffName = uploaderStaff;
        } else {
          if (parsedStaff) {
            lastKnownStaff = parsedStaff;
            staffName = parsedStaff;
          } else {
            staffName = lastKnownStaff || 'Chưa phân bổ';
          }
        }

        const department = bm ? `BM: ${bm}` : 'Content Marketing';
        const note = [workflow, status].filter(Boolean).join(' | ');

        if (pageName || pageId) {
          const finalPageName = pageName || `Page ${pageId}`;
          const pageUrl = pageId ? `https://facebook.com/${pageId}` : '';

          if (staffName && staffName !== 'Chưa phân bổ' && staffName !== 'Unassigned') {
            insertStaff.run(staffName, department);
          }

          if (pageId) deleteOldMasterById.run(pageId);
          insertMaster.run(finalPageName, pageId, staffName, department, topic, bm, workflow, status, note);

          // Sync to pages table by page_id first, or name if no page_id
          let existing = null;
          if (pageId) {
            existing = findByPageId.get(pageId);
          } else {
            existing = findByName.get(finalPageName);
          }

          if (existing) {
            updatePageStaff.run(finalPageName, staffName, topic, pageUrl, pageUrl, existing.id);
          } else {
            try {
              insertNewPage.run(finalPageName, pageId, pageUrl, staffName, topic);
            } catch (e) {
              // Ignore if any constraint
            }
          }

          count++;
        }
      }
    });

    trx(rows);
    try { if (filePath) fs.unlinkSync(filePath); } catch (e) {}

    res.json({ success: true, message: `Đã nạp thành công ${count} Fanpage có chủ đề vào danh sách gốc!`, count });
  } catch (err) {
    try { if (filePath) fs.unlinkSync(filePath); } catch (e) {}
    res.status(500).json({ success: false, error: err.message });
  }
});

// ----------------------------------------------------
// 2.15 TOPIC ANALYTICS APIs
// ----------------------------------------------------
app.get('/api/topics', (req, res) => {
  try {
    const { staff_name } = req.query;
    const isStaffFiltered = staff_name && staff_name !== 'all' && staff_name !== 'Admin';

    // Get latest date recorded
    const latestDateRow = db.prepare('SELECT MAX(report_date) as maxDate FROM daily_metrics').get();
    const latestDate = latestDateRow?.maxDate || new Date().toISOString().split('T')[0];

    // Get all pages with their topic and metrics
    let query = `
      SELECT 
        COALESCE(NULLIF(TRIM(p.topic), ''), 'Chưa phân loại') as topic_name,
        p.name as page_name,
        p.category,
        p.page_url,
        p.page_id,
        p.avatar_url,
        p.staff_name,
        COALESCE(m.views, 0) as views,
        COALESCE(m.posts_per_day, 0) as posts_per_day,
        COALESCE(m.post_count, 0) as post_count,
        COALESCE(m.interactions, 0) as interactions,
        COALESCE(m.engagement_rate, 0) as engagement_rate,
        COALESCE(m.followers, 0) as followers,
        -- Prior period views (7 days before latestDate) for growth calculation
        (
          SELECT COALESCE(views, 0) 
          FROM daily_metrics 
          WHERE page_name = p.name 
          AND report_date <= date(?, '-7 days') 
          ORDER BY report_date DESC LIMIT 1
        ) as prior_views
      FROM pages p
      LEFT JOIN daily_metrics m ON p.name = m.page_name AND m.report_date = ?
      WHERE 1=1
    `;
    const params = [latestDate, latestDate];
    if (isStaffFiltered) {
      query += ' AND p.staff_name = ?';
      params.push(staff_name);
    }

    const pageRows = db.prepare(query).all(...params);

    // Group by Topic
    const topicMap = {};
    for (const row of pageRows) {
      const tName = row.topic_name;
      if (!topicMap[tName]) {
        topicMap[tName] = {
          topic_name: tName,
          page_count: 0,
          total_views: 0,
          prior_views: 0,
          total_posts: 0,
          total_interactions: 0,
          sum_posts_per_day: 0,
          sum_engagement_rate: 0,
          pages: [],
          top_page: null
        };
      }

      const t = topicMap[tName];
      t.page_count++;
      t.total_views += row.views;
      t.prior_views += (row.prior_views || Math.round(row.views * 0.85));
      t.total_posts += row.post_count;
      t.total_interactions += row.interactions;
      t.sum_posts_per_day += row.posts_per_day;
      t.sum_engagement_rate += row.engagement_rate;
      t.pages.push(row);

      if (!t.top_page || row.views > (t.top_page.views || 0)) {
        t.top_page = {
          name: row.page_name,
          views: row.views,
          posts_per_day: row.posts_per_day,
          engagement_rate: row.engagement_rate,
          staff_name: row.staff_name,
          page_url: row.page_url
        };
      }
    }

    // Compute aggregated rates and growth for each topic
    const topicList = Object.values(topicMap).map(t => {
      const avgPostsPerDay = t.page_count > 0 ? Number((t.sum_posts_per_day / t.page_count).toFixed(2)) : 0;
      const avgER = t.page_count > 0 ? Number((t.sum_engagement_rate / t.page_count).toFixed(2)) : 0;
      
      // Growth rate %
      let growthRate = 0;
      if (t.prior_views > 0) {
        growthRate = Number((((t.total_views - t.prior_views) / t.prior_views) * 100).toFixed(1));
      } else if (t.total_views > 0) {
        growthRate = 100.0;
      }

      // Efficiency Rating
      let rating = 'Tiềm năng ⭐⭐';
      let ratingClass = 'potential';
      if (t.total_views >= 20000 || (growthRate >= 15 && avgER >= 2.0)) {
        rating = 'Xuất sắc ⭐⭐⭐';
        ratingClass = 'excellent';
      } else if (growthRate < 0 || avgPostsPerDay < 1.0) {
        rating = 'Cần tối ưu ⚠️';
        ratingClass = 'needs_optimization';
      }

      return {
        topic_name: t.topic_name,
        page_count: t.page_count,
        total_views: t.total_views,
        avg_posts_per_day: avgPostsPerDay,
        total_posts: t.total_posts,
        total_interactions: t.total_interactions,
        avg_engagement_rate: avgER,
        growth_rate: growthRate,
        rating,
        ratingClass,
        top_page: t.top_page,
        pages: t.pages
      };
    });

    // Sort by total views descending by default
    topicList.sort((a, b) => b.total_views - a.total_views);

    // Topic KPI summaries (prioritize classified topics for meaningful insights)
    const classifiedTopics = topicList.filter(t => t.topic_name !== 'Chưa phân loại');
    const pool = classifiedTopics.length > 0 ? classifiedTopics : topicList;

    const totalTopics = topicList.length;
    const topViewsTopic = pool.length > 0 ? [...pool].sort((a, b) => b.total_views - a.total_views)[0] : null;
    const topGrowthTopic = pool.length > 0 ? [...pool].sort((a, b) => b.growth_rate - a.growth_rate)[0] : null;
    const topPostsTopic = pool.length > 0 ? [...pool].sort((a, b) => b.avg_posts_per_day - a.avg_posts_per_day)[0] : null;

    res.json({
      success: true,
      data: topicList,
      summary: {
        totalTopics,
        topViewsTopic,
        topGrowthTopic,
        topPostsTopic
      }
    });
  } catch (err) {
    console.error('Error in /api/topics:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ----------------------------------------------------
// 2.2 TOP CONTENT / POSTS APIs
// ----------------------------------------------------
app.get('/api/posts', (req, res) => {
  try {
    const { 
      page_name, 
      staff_name, 
      q, 
      sort_by = 'interactions', 
      order = 'desc', 
      limit = 100,
      start_date,
      end_date
    } = req.query;

    let query = `
      SELECT 
        po.*,
        p.page_url as page_link,
        p.avatar_url as page_avatar,
        p.staff_name as assigned_staff
      FROM posts po
      LEFT JOIN pages p ON po.page_name = p.name
      WHERE 1=1
    `;
    const params = [];

    if (page_name && page_name !== 'all') {
      query += ' AND po.page_name = ?';
      params.push(page_name);
    }

    if (staff_name && staff_name !== 'all' && staff_name !== 'Admin') {
      query += ' AND (po.staff_name = ? OR p.staff_name = ?)';
      params.push(staff_name, staff_name);
    }

    if (q && q.trim()) {
      query += ' AND (po.message LIKE ? OR po.page_name LIKE ?)';
      params.push(`%${q.trim()}%`, `%${q.trim()}%`);
    }

    if (start_date) {
      query += ' AND po.published_at >= ?';
      params.push(start_date);
    }

    if (end_date) {
      query += ' AND po.published_at <= ?';
      params.push(end_date);
    }

    // Allowed sort columns
    const allowedSorts = [
      'interactions', 
      'likes', 
      'comments', 
      'shares', 
      'interaction_rate', 
      'reach', 
      'interactions_per_impression', 
      'negative_sentiment_share', 
      'published_at',
      'id'
    ];
    const sortCol = allowedSorts.includes(sort_by) ? sort_by : 'interactions';
    const sortDir = String(order).toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    query += ` ORDER BY po.${sortCol} ${sortDir}, po.id DESC LIMIT ?`;
    params.push(parseInt(limit, 10) || 100);

    const posts = db.prepare(query).all(...params);

    // Summary metrics for the filtered subset
    let summaryQuery = `
      SELECT 
        COUNT(*) as total_posts,
        SUM(po.interactions) as total_interactions,
        SUM(po.likes) as total_likes,
        SUM(po.comments) as total_comments,
        SUM(po.shares) as total_shares,
        AVG(po.interaction_rate) as avg_interaction_rate,
        AVG(po.reach) as avg_reach,
        AVG(po.interactions_per_impression) as avg_ipi
      FROM posts po
      LEFT JOIN pages p ON po.page_name = p.name
      WHERE 1=1
    `;
    const summaryParams = [];

    if (page_name && page_name !== 'all') {
      summaryQuery += ' AND po.page_name = ?';
      summaryParams.push(page_name);
    }
    if (staff_name && staff_name !== 'all' && staff_name !== 'Admin') {
      summaryQuery += ' AND (po.staff_name = ? OR p.staff_name = ?)';
      summaryParams.push(staff_name, staff_name);
    }
    if (q && q.trim()) {
      summaryQuery += ' AND (po.message LIKE ? OR po.page_name LIKE ?)';
      summaryParams.push(`%${q.trim()}%`, `%${q.trim()}%`);
    }

    const summary = db.prepare(summaryQuery).get(...summaryParams);
    const topPost = posts.length > 0 ? posts[0] : null;

    res.json({
      success: true,
      data: posts,
      summary: {
        totalPosts: summary?.total_posts || 0,
        totalInteractions: summary?.total_interactions || 0,
        totalLikes: summary?.total_likes || 0,
        totalComments: summary?.total_comments || 0,
        totalShares: summary?.total_shares || 0,
        avgInteractionRate: Number((summary?.avg_interaction_rate || 0).toFixed(4)),
        avgReach: Math.round(summary?.avg_reach || 0),
        avgIpi: Number((summary?.avg_ipi || 0).toFixed(2)),
        topPost
      }
    });
  } catch (err) {
    console.error('Error in /api/posts:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/posts', (req, res) => {
  try {
    const {
      page_name,
      post_id,
      post_url,
      message,
      thumbnail_url,
      media_type,
      published_at,
      likes,
      comments,
      shares,
      reach,
      interactions_per_impression,
      negative_sentiment_share,
      staff_name
    } = req.body;

    if (!page_name || !page_name.trim()) {
      return res.status(400).json({ success: false, error: 'Tên fanpage không được để trống.' });
    }

    const numLikes = parseInt(likes || 0, 10) || 0;
    const numComments = parseInt(comments || 0, 10) || 0;
    const numShares = parseInt(shares || 0, 10) || 0;
    const totalInteractions = numLikes + numComments + numShares;
    const numReach = parseInt(reach || 0, 10) || 0;
    const ipi = parseFloat(interactions_per_impression || 0) || 0;
    const er = numReach > 0 ? parseFloat(((totalInteractions / numReach) * 100).toFixed(4)) : 0;
    const matchedStaff = staff_name || findStaffForPage(page_name) || 'Chưa phân bổ';

    const info = db.prepare(`
      INSERT INTO posts 
      (page_name, post_id, post_url, message, thumbnail_url, media_type, published_at, likes, comments, shares, interactions, interaction_rate, reach, interactions_per_impression, negative_sentiment_share, staff_name, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Thủ công')
    `).run(
      page_name.trim(),
      post_id || '',
      post_url || '',
      message || '',
      thumbnail_url || '',
      media_type || 'video',
      published_at || new Date().toISOString(),
      numLikes,
      numComments,
      numShares,
      totalInteractions,
      er,
      numReach,
      ipi,
      parseFloat(negative_sentiment_share || 0) || 0,
      matchedStaff
    );

    res.json({ success: true, message: 'Đã thêm bài viết thành công!', id: info.lastInsertRowid });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/posts/:id', (req, res) => {
  try {
    db.prepare('DELETE FROM posts WHERE id = ?').run(req.params.id);
    res.json({ success: true, message: 'Đã xóa bài viết khỏi danh sách.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ----------------------------------------------------
// 3. METRICS HISTORY & LOGS APIs
// ----------------------------------------------------
app.get('/api/metrics', (req, res) => {
  try {
    const { page_name, start_date, end_date, staff_name, limit = 200 } = req.query;
    let query = `
      SELECT 
        m.*,
        COALESCE(p.page_url, CASE WHEN m.page_id IS NOT NULL THEN 'https://facebook.com/' || m.page_id ELSE '' END) as page_url,
        COALESCE(m.page_id, p.page_id) as page_id,
        COALESCE(NULLIF(p.avatar_url, ''), CASE WHEN m.page_id IS NOT NULL THEN 'https://graph.facebook.com/' || m.page_id || '/picture?type=square' ELSE NULL END) as avatar_url,
        COALESCE(NULLIF(p.staff_name, 'Chưa phân bổ'), mp.staff_name, 'Chưa phân bổ') as staff_name
      FROM daily_metrics m
      LEFT JOIN pages p ON (m.page_id IS NOT NULL AND m.page_id != '' AND p.page_id = m.page_id) OR ((m.page_id IS NULL OR m.page_id = '') AND LOWER(TRIM(p.name)) = LOWER(TRIM(m.page_name)))
      LEFT JOIN master_pages mp ON (m.page_id IS NOT NULL AND m.page_id != '' AND mp.page_id = m.page_id) OR ((m.page_id IS NULL OR m.page_id = '') AND LOWER(TRIM(mp.page_name)) = LOWER(TRIM(m.page_name)))
      WHERE 1=1
    `;
    const params = [];

    if (page_name && page_name !== 'all') {
      query += ' AND m.page_name = ?';
      params.push(page_name);
    }
    if (staff_name && staff_name !== 'all' && staff_name !== 'Admin') {
      query += ' AND (p.staff_name = ? OR mp.staff_name = ?)';
      params.push(staff_name, staff_name);
    }
    if (start_date) {
      query += ' AND m.report_date >= ?';
      params.push(start_date);
    }
    if (end_date) {
      query += ' AND m.report_date <= ?';
      params.push(end_date);
    }

    query += ' ORDER BY m.report_date DESC, m.views DESC LIMIT ?';
    params.push(parseInt(limit, 10));

    const metrics = db.prepare(query).all(...params);
    res.json({ success: true, data: metrics });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ----------------------------------------------------
// 4. WEBHOOK INGESTION (From Google Apps Script)
// ----------------------------------------------------
app.post('/api/webhook/fanpagekarma', authenticateApiKey, (req, res) => {
  try {
    const payload = req.body;
    const sender = payload.sender || req.query.sender || 'maiduc2311@gmail.com';
    const reportDate = payload.report_date || payload.date || new Date().toISOString().split('T')[0];
    const records = payload.records || payload.data || [];

    if (!Array.isArray(records) || records.length === 0) {
      // Log failure
      db.prepare(`
        INSERT INTO webhook_logs (sender_email, status, record_count, message, raw_payload)
        VALUES (?, 'EMPTY', 0, 'Dữ liệu records rỗng hoặc không đúng định dạng', ?)
      `).run(sender, JSON.stringify(payload).substring(0, 1000));

      return res.status(400).json({ success: false, error: 'Không tìm thấy mảng records dữ liệu trong payload.' });
    }

    const findExistingPage = db.prepare(`
      SELECT id FROM pages 
      WHERE (page_id IS NOT NULL AND page_id != '' AND page_id = ?) OR name = ?
      LIMIT 1
    `);

    const updateExistingPage = db.prepare(`
      UPDATE pages SET 
        page_id = CASE WHEN ? != '' THEN ? ELSE page_id END,
        page_url = CASE WHEN ? != '' THEN ? ELSE page_url END,
        staff_name = CASE WHEN ? != 'Chưa phân bổ' THEN ? ELSE staff_name END
      WHERE id = ?
    `);

    const insertNewPage = db.prepare(`
      INSERT INTO pages (name, category, page_id, page_url, staff_name) 
      VALUES (?, ?, ?, ?, ?)
    `);

    const insertMetric = db.prepare(`
      INSERT OR REPLACE INTO daily_metrics 
      (page_name, report_date, views, posts_per_day, post_count, interactions, engagement_rate, page_performance_index, followers, source, raw_data)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertTransaction = db.transaction((rows) => {
      let savedCount = 0;
      for (const item of rows) {
        const pageName = (item.page_name || item.page || item.name || '').trim();
        if (!pageName) continue;

        const pageId = (item.page_id || item.profile_id || item.id || '').trim();
        let pageUrl = item.page_url || (pageId ? `https://facebook.com/${pageId}` : '');

        // Auto cross-reference staff from master_pages
        const matchedStaff = item.staff_name || findStaffForPage(pageName, pageId) || 'Chưa phân bổ';

        // Auto create or update page
        const existing = findExistingPage.get(pageId, pageName);
        if (existing) {
          updateExistingPage.run(pageId, pageId, pageUrl, pageUrl, matchedStaff, matchedStaff, existing.id);
        } else {
          insertNewPage.run(pageName, item.category || 'Của tôi', pageId, pageUrl, matchedStaff);
        }

        const recDate = item.report_date || item.date || reportDate;
        const views = parseInt(item.views || item.view_count || item.video_views || 0, 10) || 0;
        const postsPerDay = parseFloat(item.posts_per_day || item.posts_day || item.frequency || 0) || 0;
        const postCount = parseInt(item.post_count || item.posts || item.number_of_posts || 0, 10) || 0;
        const interactions = parseInt(item.interactions || item.reactions || item.engagement || 0, 10) || 0;
        const engagementRate = parseFloat(item.engagement_rate || item.eng_rate || item.er || 0) || 0;
        const followers = parseInt(item.followers || item.fans || item.page_likes || 0, 10) || 0;
        const source = item.source || 'Google Apps Script';
        const rawJson = JSON.stringify(item);

        insertMetric.run(
          pageName,
          recDate,
          views,
          postsPerDay,
          postCount,
          interactions,
          engagementRate,
          engagementRate,
          followers,
          source,
          rawJson
        );
        savedCount++;
      }
      return savedCount;
    });

    const saved = insertTransaction(records);

    // Log success
    db.prepare(`
      INSERT INTO webhook_logs (sender_email, status, record_count, message, raw_payload)
      VALUES (?, 'SUCCESS', ?, ?, ?)
    `).run(
      sender,
      saved,
      `Đồng bộ thành công ${saved} dòng chỉ số fanpage từ Google Apps Script (Ngày báo cáo: ${reportDate})`,
      JSON.stringify(payload).substring(0, 2000)
    );

    res.json({
      success: true,
      message: `Đã nạp thành công ${saved} bản ghi vào CRM.`,
      savedCount: saved,
      reportDate
    });
  } catch (err) {
    console.error('Webhook Error:', err);
    db.prepare(`
      INSERT INTO webhook_logs (sender_email, status, record_count, message, raw_payload)
      VALUES (?, 'ERROR', 0, ?, ?)
    `).run('system', err.message, JSON.stringify(req.body || {}).substring(0, 1000));

    res.status(500).json({ success: false, error: err.message });
  }
});

// ----------------------------------------------------
// 5. MANUAL FILE UPLOAD (Excel / CSV Parser)
// ----------------------------------------------------
app.post('/api/upload', upload.single('file'), (req, res) => {
  const fs = require('fs');
  const filePath = req.file?.path;
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'Chưa chọn file để tải lên.' });
    }

    const originalName = req.file.originalname.toLowerCase();
    let rows = [];

    // Helper to extract date from filename (e.g. 2026-08-20, 20_08_2026, 20260820)
    const extractDateFromFilename = (filename) => {
      if (!filename) return null;
      // 1. YYYY-MM-DD, YYYY_MM_DD, YYYY.MM.DD
      const m1 = filename.match(/(20\d{2})[-_./](0[1-9]|1[0-2])[-_./](0[1-9]|[12]\d|3[01])/);
      if (m1) return `${m1[1]}-${m1[2]}-${m1[3]}`;
      
      // 2. DD-MM-YYYY, DD_MM_YYYY, DD.MM.YYYY
      const m2 = filename.match(/(0[1-9]|[12]\d|3[01])[-_./](0[1-9]|1[0-2])[-_./](20\d{2})/);
      if (m2) return `${m2[3]}-${m2[2]}-${m2[1]}`;

      // 3. YYYYMMDD
      const m3 = filename.match(/(20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])/);
      if (m3) return `${m3[1]}-${m3[2]}-${m3[3]}`;

      return null;
    };

    // Helper to parse numbers like "153k", "1.2M", "12,5%", "1.234"
    const parseKarmaNumber = (val) => {
      if (val === null || val === undefined) return 0;
      let str = String(val).trim().replace(/\s/g, '');
      if (!str || str === '-' || str === 'n/a') return 0;
      
      let multiplier = 1;
      if (str.toLowerCase().endsWith('k')) {
        multiplier = 1000;
        str = str.slice(0, -1);
      } else if (str.toLowerCase().endsWith('m')) {
        multiplier = 1000000;
        str = str.slice(0, -1);
      } else if (str.endsWith('%')) {
        str = str.slice(0, -1);
      }

      // Replace comma with dot if comma is decimal separator (e.g. 12,5 -> 12.5, or 1.250 -> 1250)
      if (str.includes(',') && !str.includes('.')) {
        str = str.replace(',', '.');
      } else if (str.includes('.') && str.includes(',')) {
        // e.g. 1.234,56 -> 1234.56
        str = str.replace(/\./g, '').replace(',', '.');
      }

      const num = parseFloat(str);
      return isNaN(num) ? 0 : num * multiplier;
    };

    if (originalName.endsWith('.csv')) {
      let fileContent = fs.readFileSync(filePath, 'utf-8');
      
      // If starts with UTF-8 BOM, strip it
      if (fileContent.charCodeAt(0) === 0xFEFF) {
        fileContent = fileContent.slice(1);
      }

      // Check if first line is "sep=;" or "sep=,"
      const lines = fileContent.split(/\r?\n/);
      let startIndex = 0;
      let delimiter = ';'; // Default for European Fanpage Karma exports

      if (lines[0] && lines[0].toLowerCase().startsWith('sep=')) {
        delimiter = lines[0].substring(4).trim() || ';';
        startIndex = 1;
      } else {
        // Auto detect delimiter from first non-empty line
        const sampleLine = lines.find(l => l.trim().length > 0) || '';
        const semicolonCount = (sampleLine.match(/;/g) || []).length;
        const commaCount = (sampleLine.match(/,/g) || []).length;
        const tabCount = (sampleLine.match(/\t/g) || []).length;
        if (tabCount > semicolonCount && tabCount > commaCount) delimiter = '\t';
        else if (commaCount > semicolonCount) delimiter = ',';
        else delimiter = ';';
      }

      const cleanContent = lines.slice(startIndex).join('\n');

      rows = parse(cleanContent, {
        columns: true,
        delimiter: delimiter,
        skip_empty_lines: true,
        trim: true,
        relax_quotes: true,
        relax_column_count: true
      });
    } else {
      // Excel (.xlsx, .xls)
      const workbook = xlsx.readFile(filePath);
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      rows = xlsx.utils.sheet_to_json(sheet, { defval: '' });
    }

    // Smart Column Matcher for Fanpage Karma exports
    // Check if the uploaded file is a Posts Report / Top Content report
    const sampleRow = rows[0] || {};
    const sampleKeys = Object.keys(sampleRow).map(k => k.toLowerCase().replace(/[\s_\-\.\/\(\)\[\]\%]/g, ''));

    const isPageReport = sampleKeys.some(k => 
      k.includes('dailyviews') || 
      k.includes('reachperday') || 
      k.includes('pageperformanceindex') || 
      k.includes('postsperday') || 
      (k.includes('numberofposts') && !sampleKeys.includes('message'))
    );

    const isPostsReport = !isPageReport && sampleKeys.some(k => 
      k.includes('message') || 
      k.includes('caption') || 
      k.includes('posttext') || 
      k.includes('posturl') || 
      k.includes('postlink') || 
      k.includes('negativesentiment') || 
      k.includes('interactionsperimpression')
    );

    if (isPostsReport) {
      // Process as Posts / Top Content Report
      const normalizedPosts = rows.map(r => {
        const keys = Object.keys(r);
        const findKey = (candidates) => {
          for (const k of keys) {
            const cleanK = k.toLowerCase().replace(/[\s_\-\.\/\(\)\[\]\%]/g, '');
            for (const cand of candidates) {
              if (cleanK === cand) return r[k];
            }
          }
          for (const k of keys) {
            const cleanK = k.toLowerCase().replace(/[\s_\-\.\/\(\)\[\]\%]/g, '');
            for (const cand of candidates) {
              if (cleanK.includes(cand)) return r[k];
            }
          }
          return null;
        };

        const pageName = findKey(['profile', 'fanpage', 'pagename', 'page', 'name', 'tên']) || 'Unknown Page';
        const message = findKey(['message', 'caption', 'posttext', 'text', 'content', 'nộidung', 'bàiviết']) || '';
        const postId = findKey(['postid', 'id', 'idbàiviết', 'profileid']) || '';
        const postUrl = findKey(['postlink', 'link', 'url', 'posturl']) || (postId ? `https://facebook.com/${postId}` : '');
        const thumbnail = findKey(['picture', 'thumbnail', 'imagelink', 'image', 'photo', 'ảnh']) || '';
        const mediaType = findKey(['type', 'mediatype', 'posttype', 'loạibài']) || 'video';
        const dateVal = findKey(['date', 'time', 'publishedat', 'createdtime', 'ngàyđăng', 'thờigian']) || new Date().toISOString();

        const likes = Math.round(parseKarmaNumber(findKey(['numberoflikes', 'likes', 'lượtthích'])));
        const comments = Math.round(parseKarmaNumber(findKey(['numberofcomments', 'comments', 'bìnhluận'])));
        const shares = Math.round(parseKarmaNumber(findKey(['numberofshares', 'shares', 'chiasẻ'])));
        let interactions = Math.round(parseKarmaNumber(findKey(['reactionscomments&shares', 'totalinteractions', 'interactions', 'tươngtác', 'reactions'])));
        if (interactions === 0 && (likes > 0 || comments > 0 || shares > 0)) {
          interactions = likes + comments + shares;
        }

        let er = parseFloat(parseKarmaNumber(findKey(['postinteractionrate', 'interactionrate', 'er', 'tỷlệtươngtác'])));
        if (er > 0 && er < 1) er = parseFloat((er * 100).toFixed(4));

        const reach = Math.round(parseKarmaNumber(findKey(['reachperpost', 'reach', 'impressions', 'tiếpcận', 'views'])));
        const ipi = parseFloat(parseKarmaNumber(findKey(['interactionsperimpression/view', 'interactionsperimpression', 'interactions/view', 'ipi'])));
        const negativeSentiment = parseFloat(parseKarmaNumber(findKey(['postcommentsnegativesentimentshare', 'negativesentimentshare', 'negativesentiment', 'tiêucực'])));

        return {
          page_name: String(pageName).trim(),
          post_id: String(postId).trim(),
          post_url: String(postUrl).trim(),
          message: String(message).trim(),
          thumbnail_url: String(thumbnail).trim(),
          media_type: String(mediaType).toLowerCase(),
          published_at: String(dateVal),
          likes,
          comments,
          shares,
          interactions,
          interaction_rate: er,
          reach,
          interactions_per_impression: ipi,
          negative_sentiment_share: negativeSentiment,
          source: `Upload: ${req.file.originalname}`
        };
      }).filter(p => p.page_name && p.page_name !== 'Unknown Page' && (p.message.trim().length > 0 || (p.post_url && (p.post_url.includes('/posts/') || p.post_url.includes('/reel/')))));

      const insertPost = db.prepare(`
        INSERT INTO posts 
        (page_name, post_id, post_url, message, thumbnail_url, media_type, published_at, likes, comments, shares, interactions, interaction_rate, reach, interactions_per_impression, negative_sentiment_share, staff_name, source)
        VALUES (@page_name, @post_id, @post_url, @message, @thumbnail_url, @media_type, @published_at, @likes, @comments, @shares, @interactions, @interaction_rate, @reach, @interactions_per_impression, @negative_sentiment_share, @staff_name, @source)
      `);

      let postCount = 0;
      const postTrx = db.transaction((items) => {
        for (const item of items) {
          const matchedStaff = findStaffForPage(item.page_name) || 'Chưa phân bổ';
          insertPost.run({
            ...item,
            staff_name: matchedStaff
          });
          postCount++;
        }
      });

      postTrx(normalizedPosts);
      try { if (filePath) fs.unlinkSync(filePath); } catch (e) {}

      return res.json({
        success: true,
        message: `Đã nạp thành công ${postCount} bài viết Top Content vào hệ thống!`,
        count: postCount,
        type: 'posts'
      });
    }

    // Default: Process as Daily Fanpage Metrics Report
    const normalizedRecords = rows.map(r => {
      const keys = Object.keys(r);
      const findKey = (candidates) => {
        // First try exact normalized match
        for (const k of keys) {
          const cleanK = k.toLowerCase().replace(/[\s_\-\.\/\(\)\[\]\%]/g, '');
          for (const cand of candidates) {
            if (cleanK === cand) return r[k];
          }
        }
        // Then try substring match
        for (const k of keys) {
          const cleanK = k.toLowerCase().replace(/[\s_\-\.\/\(\)\[\]\%]/g, '');
          for (const cand of candidates) {
            if (cleanK.includes(cand)) return r[k];
          }
        }
        return null;
      };

      const pageName = findKey(['tênpage', 'tenpage', 'têntrang', 'tentrang', 'fanpage', 'pagename', 'page', 'profile', 'name', 'tên']) || 'Unknown Page';
      const pageIdRaw = findKey(['profile-id', 'profileid', 'idpage', 'id page', 'pageid', 'page id', 'id', 'mãpage', 'mapage', 'fb id', 'fbid']);
      const avatarRaw = findKey(['imagelink', 'image', 'avatar', 'avatarurl', 'logo', 'ảnh']);
      const linkRaw = findKey(['link', 'urllink', 'url', 'profilelink']);
      const topicRaw = findKey(['chủđề', 'chude', 'chủde', 'topic', 'theme', 'niche', 'chuyênmục', 'chuyenmuc', 'ngành', 'lĩnhvực', 'linhvuc', 'category']);
      const staffRaw = findKey(['nhânsựphụtrách', 'nhansuphutrach', 'nhânsự', 'nhansu', 'ngườiphụtrách', 'nguoiphutrach', 'nhânviên', 'nhanvien', 'staff', 'owner', 'assignee', 'nv']);

      let pageId = '';
      let pageUrl = '';

      if (pageIdRaw && String(pageIdRaw).trim() !== '') {
        pageId = String(pageIdRaw).trim();
        pageUrl = `https://facebook.com/${pageId}`;
      } else if (linkRaw && String(linkRaw).trim() !== '') {
        let cleanLink = String(linkRaw).trim();
        // If link is fanpage karma discovery link e.g. https://app.fanpagekarma.com/discovery/FACEBOOK/102106739610422
        const karmaMatch = cleanLink.match(/discovery\/[A-Z]+\/([0-9]+)/i);
        if (karmaMatch && karmaMatch[1]) {
          pageId = karmaMatch[1];
          pageUrl = `https://facebook.com/${pageId}`;
        } else if (cleanLink.startsWith('http')) {
          pageUrl = cleanLink;
        } else {
          pageId = cleanLink.replace(/^@/, '');
          pageUrl = `https://facebook.com/${pageId}`;
        }
      }

      const viewsRaw = findKey(['dailyviews', 'videoviews', 'videoview', 'pageviews', 'views', 'view', 'lượt xem', 'impressions']);
      const postsPerDayRaw = findKey(['postsperday', 'posts/day', 'bài/ngày', 'frequency', 'postperday', 'anzahlposts']);
      const postCountRaw = findKey(['numberofposts', 'postcount', 'bàiđăng', 'sốbài', 'posts', 'anzahlposts']);
      
      const likesRaw = findKey(['numberoflikes', 'likes']);
      const commentsRaw = findKey(['numberofcomments', 'comments']);
      const interactionsRaw = findKey(['totalinteractions', 'interactions', 'tươngtác', 'engagement', 'reactions']);
      
      const ppiRaw = findKey(['pageperformanceindex', 'performanceindex', 'pageperformance', 'ppi']);
      const erRaw = ppiRaw || findKey(['postinteractionrate', 'interactionrate', 'engagementrate', 'pagerate']);
      const followersRaw = findKey(['follower', 'followers', 'fans', 'ngườitheodõi', 'fan']);
      const filenameDate = extractDateFromFilename(req.file?.originalname);
      const dateVal = findKey(['reportdate', 'date', 'ngày', 'time', 'thờigian', 'period']) 
        || (req.body && req.body.report_date) 
        || (req.query && req.query.report_date) 
        || filenameDate 
        || new Date().toISOString().split('T')[0];

      const views = Math.round(parseKarmaNumber(viewsRaw));
      const postCount = Math.round(parseKarmaNumber(postCountRaw));
      
      // Calculate posts per day from weekly posts / 7 if needed
      let postsPerDay = parseFloat(parseKarmaNumber(postsPerDayRaw).toFixed(2));
      if (postsPerDay === 0 && postCount > 0) {
        postsPerDay = parseFloat((postCount / 7).toFixed(1));
      }

      let interactions = Math.round(parseKarmaNumber(interactionsRaw));
      if (interactions === 0 && (likesRaw || commentsRaw)) {
        interactions = Math.round(parseKarmaNumber(likesRaw) + parseKarmaNumber(commentsRaw));
      }

      let engagementRate = parseFloat(parseKarmaNumber(erRaw));
      // If ER is in decimal form (e.g. 0.00086 -> 0.09%)
      if (engagementRate > 0 && engagementRate < 1) {
        engagementRate = parseFloat((engagementRate * 100).toFixed(2));
      } else {
        engagementRate = parseFloat(engagementRate.toFixed(2));
      }

      const followers = Math.round(parseKarmaNumber(followersRaw));
      const avatarUrl = avatarRaw ? String(avatarRaw).trim() : '';

      return {
        page_name: String(pageName).trim(),
        page_id: pageId,
        page_url: pageUrl,
        avatar_url: avatarUrl,
        topic: topicRaw ? String(topicRaw).trim() : '',
        staff_name: staffRaw ? String(staffRaw).trim() : '',
        report_date: String(dateVal).substring(0, 10),
        views,
        posts_per_day: postsPerDay,
        post_count: postCount,
        interactions,
        engagement_rate: engagementRate,
        followers,
        source: `Upload: ${req.file.originalname}`
      };
    }).filter(item => item.page_name && item.page_name !== 'Unknown Page');

    if (normalizedRecords.length === 0) {
      return res.status(400).json({ success: false, error: 'Không nhận diện được cột dữ liệu Fanpage trong file.' });
    }

    // Insert into DB without fragile ON CONFLICT clauses
    const findExistingPage = db.prepare(`
      SELECT id FROM pages 
      WHERE (page_id IS NOT NULL AND page_id != '' AND page_id = ?) OR name = ?
      LIMIT 1
    `);

    const updateExistingPage = db.prepare(`
      UPDATE pages SET 
        page_id = CASE WHEN ? != '' THEN ? ELSE page_id END,
        page_url = CASE WHEN ? != '' THEN ? ELSE page_url END,
        avatar_url = CASE WHEN ? != '' THEN ? ELSE avatar_url END,
        staff_name = CASE WHEN ? != 'Chưa phân bổ' THEN ? ELSE staff_name END,
        topic = CASE WHEN ? != 'Chưa phân loại' THEN ? ELSE topic END
      WHERE id = ?
    `);

    const insertNewPage = db.prepare(`
      INSERT INTO pages (name, category, page_id, page_url, avatar_url, staff_name, topic) 
      VALUES (?, 'Của tôi', ?, ?, ?, ?, ?)
    `);

    const insertMetric = db.prepare(`
      INSERT OR REPLACE INTO daily_metrics 
      (page_id, page_name, report_date, views, posts_per_day, post_count, interactions, engagement_rate, followers, source, raw_data)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const uploaderStaff = (req.query.staff_name || req.body?.staff_name || '').trim();
    const isStaffUploader = uploaderStaff && uploaderStaff !== 'Admin';

    let count = 0;
    const trx = db.transaction((items) => {
      for (const item of items) {
        // Determine Staff Name: from file -> or logged-in staff -> or cross-reference master_pages
        let finalStaff = 'Chưa phân bổ';
        if (item.staff_name) {
          finalStaff = item.staff_name;
        } else if (isStaffUploader) {
          finalStaff = uploaderStaff;
        } else {
          finalStaff = findStaffForPage(item.page_name, item.page_id) || 'Chưa phân bổ';
        }

        // Determine Topic: from file -> or cross-reference master_pages
        const finalTopic = item.topic || findTopicForPage(item.page_name, item.page_id) || 'Chưa phân loại';

        const existing = findExistingPage.get(item.page_id || '', item.page_name);
        if (existing) {
          updateExistingPage.run(
            item.page_id || '', item.page_id || '',
            item.page_url || '', item.page_url || '',
            item.avatar_url || '', item.avatar_url || '',
            finalStaff, finalStaff,
            finalTopic, finalTopic,
            existing.id
          );
        } else {
          insertNewPage.run(item.page_name, item.page_id || '', item.page_url || '', item.avatar_url || '', finalStaff, finalTopic);
        }

        // Auto sync into master_pages so it registers in Staff & Master list permanently
        if (finalStaff && finalStaff !== 'Chưa phân bổ') {
          const existsMaster = db.prepare("SELECT id FROM master_pages WHERE (page_id IS NOT NULL AND page_id != '' AND page_id = ?) OR LOWER(TRIM(page_name)) = LOWER(TRIM(?))").get(item.page_id || '', item.page_name);
          if (!existsMaster) {
            try {
              db.prepare(`
                INSERT INTO master_pages (page_name, page_id, staff_name, department, topic, bm, workflow, status, note)
                VALUES (?, ?, ?, 'Content Marketing', ?, '', '', 'Active', 'Tự động tạo khi nhân sự nạp báo cáo')
              `).run(item.page_name, item.page_id || '', finalStaff, finalTopic);
            } catch (err) {}
          }
        }

        insertMetric.run(
          item.page_id || '',
          item.page_name,
          item.report_date,
          item.views,
          item.posts_per_day,
          item.post_count,
          item.interactions,
          item.engagement_rate,
          item.followers,
          item.source,
          JSON.stringify(item)
        );
        count++;
      }
    });

    trx(normalizedRecords);

    // Clean up temp file
    try { if (filePath) fs.unlinkSync(filePath); } catch (e) {}

    res.json({
      success: true,
      message: `Đã nạp thành công ${count} trang Fanpage từ file vào CRM!`,
      count,
      sample: normalizedRecords.slice(0, 3)
    });
  } catch (err) {
    console.error('Upload error:', err);
    try { if (filePath) fs.unlinkSync(filePath); } catch (e) {}
    res.status(500).json({ success: false, error: err.message });
  }
});

// ----------------------------------------------------
// 6. WEBHOOK LOGS & SETTINGS APIs
// ----------------------------------------------------
app.get('/api/webhook-logs', (req, res) => {
  try {
    const logs = db.prepare('SELECT * FROM webhook_logs ORDER BY id DESC LIMIT 50').all();
    res.json({ success: true, data: logs });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/settings', (req, res) => {
  try {
    const apiKey = getApiKey();
    res.json({
      success: true,
      data: {
        apiKey,
        webhookUrl: `http://localhost:${PORT}/api/webhook/fanpagekarma`,
        targetEmail: 'maiduc2311@gmail.com'
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/settings', (req, res) => {
  try {
    const { apiKey } = req.body;
    if (!apiKey || !apiKey.trim()) {
      return res.status(400).json({ success: false, error: 'API Key không được để trống.' });
    }
    setApiKey(apiKey.trim());
    res.json({ success: true, message: 'Đã cập nhật API Key mới.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/reset-data', (req, res) => {
  try {
    db.prepare('DELETE FROM daily_metrics').run();
    db.prepare('DELETE FROM pages').run();
    db.prepare('DELETE FROM webhook_logs').run();
    db.prepare('DELETE FROM posts').run();
    
    // Re-seed
    const { seedSamplePosts } = require('./db');
    seedSamplePosts();
    
    res.json({ success: true, message: 'Đã reset cơ sở dữ liệu về mặc định.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ----------------------------------------------------
// 7.5. FACEBOOK PAGE SCANNER & IMPORT ROUTES
// ----------------------------------------------------
app.get('/connect-facebook', (req, res) => {
  try {
    const fs = require('fs');
    const html = fs.readFileSync(path.join(__dirname, 'public', 'connect-facebook.html'), 'utf8');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) {
    res.status(500).send('Lỗi tải trang kết nối: ' + err.message);
  }
});

app.post('/api/facebook/import-pages', (req, res) => {
  try {
    const { staffName, department, topic, pages } = req.body;
    if (!staffName || !Array.isArray(pages) || pages.length === 0) {
      return res.status(400).json({ success: false, error: 'Thiếu thông tin nhân sự hoặc danh sách trang.' });
    }

    const findMaster = db.prepare(`SELECT id FROM master_pages WHERE (page_id IS NOT NULL AND page_id != '' AND page_id = ?) OR LOWER(TRIM(page_name)) = LOWER(TRIM(?)) LIMIT 1`);
    const updateMaster = db.prepare(`UPDATE master_pages SET staff_name = ?, page_id = COALESCE(NULLIF(?, ''), page_id), department = COALESCE(NULLIF(?, ''), department), topic = COALESCE(NULLIF(?, ''), topic) WHERE id = ?`);
    const insertMaster = db.prepare(`INSERT INTO master_pages (page_name, page_id, staff_name, department, topic, status) VALUES (?, ?, ?, ?, ?, 'Active')`);

    const findPage = db.prepare(`SELECT id FROM pages WHERE (page_id IS NOT NULL AND page_id != '' AND page_id = ?) OR LOWER(TRIM(name)) = LOWER(TRIM(?)) LIMIT 1`);
    const updatePage = db.prepare(`UPDATE pages SET staff_name = ?, page_id = COALESCE(NULLIF(?, ''), page_id), avatar_url = COALESCE(NULLIF(?, ''), avatar_url), page_url = COALESCE(NULLIF(?, ''), page_url), topic = COALESCE(NULLIF(?, ''), topic) WHERE id = ?`);
    const insertPage = db.prepare(`INSERT INTO pages (name, category, page_id, page_url, avatar_url, staff_name, topic) VALUES (?, 'Của tôi', ?, ?, ?, ?, ?)`);

    let importedCount = 0;
    const runImport = db.transaction((pageList) => {
      for (const p of pageList) {
        const pageName = (p.pageName || p.name || '').trim();
        if (!pageName) continue;
        const pageId = (p.pageId || p.id || '').trim();
        const pageUrl = p.pageUrl || p.link || (pageId ? `https://facebook.com/${pageId}` : '');
        const avatarUrl = p.avatarUrl || p.picture?.data?.url || p.picture || '';
        const pageTopic = p.topic || topic || 'Chưa phân loại';
        const pageDept = p.department || department || 'Content Marketing';

        // Update or Insert in master_pages
        const existingM = findMaster.get(pageId, pageName);
        if (existingM) {
          updateMaster.run(staffName, pageId, pageDept, pageTopic, existingM.id);
        } else {
          insertMaster.run(pageName, pageId, staffName, pageDept, pageTopic);
        }

        // Update or Insert in pages
        const existingP = findPage.get(pageId, pageName);
        if (existingP) {
          updatePage.run(staffName, pageId, avatarUrl, pageUrl, pageTopic, existingP.id);
        } else {
          insertPage.run(pageName, pageId, pageUrl, avatarUrl, staffName, pageTopic);
        }

        importedCount++;
      }
    });

    runImport(pages);

    res.json({
      success: true,
      message: `Đã nạp thành công ${importedCount} Fanpage cho nhân sự "${staffName}"!`,
      count: importedCount
    });
  } catch (err) {
    console.error('Import Facebook Pages error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

function normalizeDateString(dateStr) {
  if (!dateStr) return new Date().toISOString().split('T')[0];
  dateStr = String(dateStr).trim();
  
  // Format: YYYY-MM-DD or YYYY-M-D or YYYY/MM/DD
  if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(dateStr)) {
    const parts = dateStr.split(/[-/]/);
    const y = parts[0];
    const m = parts[1].padStart(2, '0');
    const d = parts[2].padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  // Format: DD/MM/YYYY or D/M/YYYY or DD-MM-YYYY
  if (/^\d{1,2}[-/]\d{1,2}[-/]\d{4}$/.test(dateStr)) {
    const parts = dateStr.split(/[-/]/);
    const d = parts[0].padStart(2, '0');
    const m = parts[1].padStart(2, '0');
    const y = parts[2];
    return `${y}-${m}-${d}`;
  }

  const parsed = new Date(dateStr);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString().split('T')[0];
  }

  return dateStr;
}

// ----------------------------------------------------
// 8. CHROME EXTENSION KARMA SYNC ROUTE
// ----------------------------------------------------
app.all('/api/karma/sync', async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method === 'GET') {
    return res.json({
      status: 'ok',
      message: 'Karma Sync API endpoint is active and ready to accept POST requests from Chrome Extension.',
      method: 'POST',
      samplePayload: {
        date: '2026-08-01',
        reports: [
          {
            pageName: 'Serene Nest',
            pageId: '116968391371812',
            numberOfPosts: 1,
            views: 2038,
            followers: 58989,
            er: 0.05
          }
        ]
      }
    });
  }

  try {
    const body = req.body || {};
    const rawReports = Array.isArray(body)
      ? body
      : (body.reports || body.data || body.items || []);
      
    const rawDate = body.date || body.reportDate || (rawReports[0]?.updatedDate || rawReports[0]?.date) || new Date().toISOString().split('T')[0];
    const syncDate = normalizeDateString(rawDate);

    if (!Array.isArray(rawReports) || rawReports.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Không tìm thấy danh sách báo cáo (reports) trong dữ liệu gửi lên.',
      });
    }

    const findStaffQuery = db.prepare(`
      SELECT staff_name, topic, department 
      FROM master_pages 
      WHERE (page_id IS NOT NULL AND page_id != '' AND page_id = ?) 
         OR LOWER(TRIM(page_name)) = LOWER(TRIM(?))
      LIMIT 1
    `);

    const findExistingPage = db.prepare(`
      SELECT id, name, page_id, avatar_url, staff_name, topic 
      FROM pages 
      WHERE (page_id IS NOT NULL AND page_id != '' AND page_id = ?) 
         OR LOWER(TRIM(name)) = LOWER(TRIM(?))
      LIMIT 1
    `);

    const insertNewPage = db.prepare(`
      INSERT INTO pages (name, category, page_id, page_url, avatar_url, staff_name, topic) 
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const updateExistingPage = db.prepare(`
      UPDATE pages 
      SET page_id = COALESCE(NULLIF(?, ''), page_id),
          page_url = COALESCE(NULLIF(?, ''), page_url),
          avatar_url = COALESCE(NULLIF(?, ''), avatar_url),
          staff_name = CASE WHEN staff_name = 'Chưa phân bổ' OR staff_name IS NULL THEN ? ELSE staff_name END,
          topic = CASE WHEN topic = 'Chưa phân loại' OR topic IS NULL THEN ? ELSE topic END
      WHERE id = ?
    `);

    const insertMetric = db.prepare(`
      INSERT OR REPLACE INTO daily_metrics 
      (page_id, page_name, report_date, views, posts_per_day, post_count, interactions, engagement_rate, followers, source, raw_data)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    let savedCount = 0;

    const runSyncTransaction = db.transaction((items) => {
      for (const item of items) {
        const pageName = (item.pageName || item.page_name || item.name || item.Profile || item.page || '').trim();
        if (!pageName) continue;

        const pageId = (item.pageId || item.page_id || item.profileId || item['Profile-ID'] || item.id || '').trim();
        const itemDate = item.updatedDate || item.report_date || item.date;
        const reportDate = itemDate ? normalizeDateString(itemDate) : syncDate;
        
        const views = parseInt(item.views || item.dailyViews || item.daily_views || item['Daily Views'] || item['Reach per day'] || 0, 10) || 0;
        const postCount = parseInt(item.numberOfPosts || item.number_of_posts || item.postCount || item.post_count || item.posts || item['Number of posts'] || 0, 10) || 0;
        const postsPerDay = postCount;
        const followers = parseInt(item.followers || item.follower || item['Follower'] || 0, 10) || 0;
        const engagementRate = parseFloat(item.page_performance_index || item.ppi || item.performance_index || item.pagePerformanceIndex || item['Page Performance Index'] || item.er || item.engagementRate || item.engagement_rate || 0) || 0;
        const interactions = parseInt(item.interactions || item['Number of Likes'] || item.likes || 0, 10) || 0;
        
        const avatarUrl = item.avatarUrl || item.avatar_url || item.imageLink || item['Image Link'] || '';
        let pageUrl = item.pageUrl || item.page_url || item.link || item.Link || (pageId ? `https://facebook.com/${pageId}` : '');

        // Auto cross-reference master_pages
        const masterStaff = findStaffQuery.get(pageId, pageName);
        const matchedStaff = item.staffName || item.staff_name || masterStaff?.staff_name || 'Chưa phân bổ';
        const matchedTopic = item.topic || masterStaff?.topic || 'Chưa phân loại';

        // Auto create or update page
        const existing = findExistingPage.get(pageId, pageName);
        if (existing) {
          updateExistingPage.run(
            pageId,
            pageUrl,
            avatarUrl,
            matchedStaff,
            matchedTopic,
            existing.id
          );
        } else {
          insertNewPage.run(
            pageName,
            item.category || 'Của tôi',
            pageId,
            pageUrl,
            avatarUrl,
            matchedStaff,
            matchedTopic
          );
        }

        // Insert metric
        const rawJson = JSON.stringify(item);
        insertMetric.run(
          pageId || null,
          pageName,
          reportDate,
          views,
          postsPerDay,
          postCount,
          interactions,
          engagementRate,
          engagementRate,
          followers,
          'Chrome Extension Sync',
          rawJson
        );

        savedCount++;
      }
    });

    runSyncTransaction(rawReports);

    // Log to webhook_logs
    try {
      db.prepare(`
        INSERT INTO webhook_logs (sender_email, status, record_count, message, raw_payload)
        VALUES (?, 'SUCCESS', ?, ?, ?)
      `).run(
        'Chrome Extension',
        savedCount,
        `Đồng bộ thành công ${savedCount} trang từ Extension (Ngày: ${syncDate})`,
        JSON.stringify(rawReports.slice(0, 5))
      );
    } catch (e) {}

    // Direct Real-time Sync to Supabase
    try {
      const supaMap = new Map();
      const supaList = [];

      for (const item of rawReports) {
        const pName = (item.pageName || item.page_name || item.name || item.Profile || item.page || '').trim();
        if (!pName) continue;
        const pId = (item.pageId || item.page_id || item.profileId || item['Profile-ID'] || item.id || '').trim();
        const iDate = item.updatedDate || item.report_date || item.date;
        const rDate = iDate ? normalizeDateString(iDate) : syncDate;
        const key = pName.toLowerCase() + '___' + rDate;

        if (!supaMap.has(key)) {
          const rowObj = {
            page_id: pId || null,
            page_name: pName,
            report_date: rDate,
            views: parseInt(item.views || item.dailyViews || item.daily_views || item['Daily Views'] || item['Reach per day'] || 0, 10) || 0,
            posts_per_day: parseInt(item.numberOfPosts || item.number_of_posts || item.postCount || item.post_count || item.posts || item['Number of posts'] || 0, 10) || 0,
            post_count: parseInt(item.numberOfPosts || item.number_of_posts || item.postCount || item.post_count || item.posts || item['Number of posts'] || 0, 10) || 0,
            followers: parseInt(item.followers || item.follower || item['Follower'] || 0, 10) || 0,
            engagement_rate: parseFloat(item.page_performance_index || item.ppi || item.performance_index || item.pagePerformanceIndex || item['Page Performance Index'] || item.er || item.engagementRate || item.engagement_rate || 0) || 0,
            page_performance_index: parseFloat(item.page_performance_index || item.ppi || item.performance_index || item.pagePerformanceIndex || item['Page Performance Index'] || item.er || item.engagementRate || item.engagement_rate || 0) || 0,
            interactions: parseInt(item.interactions || item['Number of Likes'] || item.likes || 0, 10) || 0,
            source: 'Fanpage Karma Extension',
            raw_data: item
          };
          supaMap.set(key, rowObj);
          supaList.push(rowObj);
        }
      }

      if (supaList.length > 0) {
        (async () => {
          for (let i = 0; i < supaList.length; i += 100) {
            const batch = supaList.slice(i, i + 100);
            await supabase.from('daily_metrics').upsert(batch, { onConflict: 'page_name,report_date' });
          }
          console.log(`[Supabase] Đã đồng bộ ${supaList.length} bản ghi ngày ${syncDate} lên Supabase.`);
        })().catch(err => console.error('[Supabase Sync Error]:', err));
      }
    } catch (supaErr) {
      console.error('[Supabase Sync Handler Error]:', supaErr);
    }

    console.log(`[Karma Sync] Đã lưu thành công ${savedCount} trang ngày ${syncDate} vào CRM!`);

    res.json({
      success: true,
      message: `Đã lưu thành công ${savedCount} trang ngày ${syncDate} vào CRM!`,
      received: rawReports.length,
      synced: savedCount,
      date: syncDate,
    });
  } catch (error) {
    console.error('[Karma Sync Error]:', error);
    try {
      db.prepare(`
        INSERT INTO webhook_logs (sender_email, status, record_count, message, raw_payload)
        VALUES (?, 'ERROR', 0, ?, ?)
      `).run(
        'Chrome Extension',
        `Lỗi đồng bộ: ${error.message}`,
        JSON.stringify(req.body).substring(0, 1000)
      );
    } catch (e) {}
    res.status(500).json({ success: false, error: error.message });
  }
});

// ----------------------------------------------------
// 9. CRON ROUTE: CHECK FANPAGE POST TARGET (1 POST/DAY) & LARK ALERT
// ----------------------------------------------------
app.all('/api/cron/check-fanpage', async (req, res) => {
  try {
    const authHeader = req.headers['authorization'];
    if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const targetDate = req.query.date || req.body?.date || (db.prepare('SELECT MAX(report_date) as maxDate FROM daily_metrics').get()?.maxDate) || new Date().toISOString().split('T')[0];
    const DAILY_TARGET_POSTS = parseInt(req.query.target || req.body?.target || '1', 10);
    const LARK_WEBHOOK_URL = req.query.webhook || req.body?.webhook || process.env.LARK_WEBHOOK_URL || (db.prepare("SELECT value FROM app_settings WHERE key = 'lark_webhook_url'").get()?.value) || '';

    const TARGET_STAFF_MEMBERS = [
      'Châu Thị Anh Thư',
      'Bùi Thị Trúc Phương',
      'Phạm Thị Thanh Nga',
      'Lê Đình Vinh',
      'Trương Thị Anh Nhung',
    ];

    // 1. Lấy dữ liệu từ master_pages (lọc đúng 5 nhân sự)
    const staffAssignments = db.prepare(`
      SELECT 
        COALESCE(page_id, '') as pageId,
        page_name as pageName,
        COALESCE(staff_name, 'Chưa phân bổ') as staffName,
        COALESCE(status, 'Active') as status,
        topic
      FROM master_pages
      WHERE (status = 'Active' OR status IS NULL)
        AND staff_name IN ('Châu Thị Anh Thư', 'Bùi Thị Trúc Phương', 'Phạm Thị Thanh Nga', 'Lê Đình Vinh', 'Trương Thị Anh Nhung')
    `).all();

    // 2. Lấy dữ liệu báo cáo hôm nay
    const fanpageReports = db.prepare(`
      SELECT 
        d.page_name as pageName,
        COALESCE(NULLIF(d.page_id, ''), p.page_id, '') as pageId,
        COALESCE(d.post_count, d.posts_per_day, 0) as postsToday,
        d.views,
        d.report_date as updatedDate
      FROM daily_metrics d
      LEFT JOIN pages p ON (d.page_id IS NOT NULL AND d.page_id != '' AND p.page_id = d.page_id) OR d.page_name = p.name
      WHERE d.report_date = ?
    `).all(targetDate);

    // 3. Gom nhóm theo 5 nhân sự & đối chiếu
    const staffReportMap = new Map();
    for (const name of TARGET_STAFF_MEMBERS) {
      staffReportMap.set(name, {
        staffName: name,
        totalPages: 0,
        completedPagesCount: 0,
        warningPages: [],
      });
    }

    for (const assignment of staffAssignments) {
      const { staffName, pageId, pageName } = assignment;
      const matchedKey = TARGET_STAFF_MEMBERS.find(n => n.toLowerCase() === staffName.toLowerCase().trim()) || staffName;

      if (!staffReportMap.has(matchedKey)) {
        staffReportMap.set(matchedKey, {
          staffName: matchedKey,
          totalPages: 0,
          completedPagesCount: 0,
          warningPages: [],
        });
      }

      const staffReport = staffReportMap.get(matchedKey);
      staffReport.totalPages += 1;

      const report = (pageId ? fanpageReports.find(r => r.pageId && r.pageId.trim() === pageId.trim()) : null) 
                  || fanpageReports.find(r => r.pageName.toLowerCase().trim() === pageName.toLowerCase().trim());

      const postsToday = report ? Math.floor(report.postsToday) : 0;

      if (postsToday < DAILY_TARGET_POSTS) {
        staffReport.warningPages.push({
          pageId,
          pageName,
          postsToday,
          target: DAILY_TARGET_POSTS,
          missingPosts: Math.max(0, DAILY_TARGET_POSTS - postsToday),
        });
      } else {
        staffReport.completedPagesCount += 1;
      }
    }

    const staffWithWarnings = Array.from(staffReportMap.values()).filter(
      s => s.totalPages > 0 && s.warningPages.length > 0
    );

    let larkSent = false;
    let larkError = null;

    if (LARK_WEBHOOK_URL) {
      try {
        let payload;
        if (staffWithWarnings.length > 0) {
          const cardElements = [
            {
              tag: 'div',
              text: {
                tag: 'lark_md',
                content: `📅 **Thời gian kiểm tra:** 19:00 ngày ${targetDate}\n🎯 **Chỉ tiêu:** Đăng ít nhất 1 bài / page / ngày\n⚠️ Phát hiện **${staffWithWarnings.length} nhân sự** chưa hoàn thành chỉ tiêu bài đăng hôm nay.`,
              },
            },
            { tag: 'hr' },
          ];

          staffWithWarnings.forEach((staff, index) => {
            const pageListContent = staff.warningPages
              .slice(0, 15)
              .map(p => {
                const badge = p.postsToday === 0 ? '🔴 [0 bài]' : `🟡 [${p.postsToday} bài]`;
                return `   • ${badge} ${p.pageName}`;
              })
              .join('\n');

            const extraCount = staff.warningPages.length > 15 ? `\n   *(và ${staff.warningPages.length - 15} page khác...)*` : '';

            cardElements.push({
              tag: 'div',
              text: {
                tag: 'lark_md',
                content: `👤 **Nhân sự:** ${staff.staffName}\n${pageListContent}${extraCount}`,
              },
            });

            if (index < staffWithWarnings.length - 1) {
              cardElements.push({ tag: 'hr' });
            }
          });

          cardElements.push(
            { tag: 'hr' },
            {
              tag: 'action',
              actions: [
                {
                  tag: 'button',
                  text: { tag: 'plain_text', content: '🔗 Mở CRM Kiểm Tra & Nạp Báo Cáo' },
                  type: 'primary',
                  url: 'https://crm-fanpage.vercel.app/',
                },
              ],
            }
          );

          payload = {
            msg_type: 'interactive',
            card: {
              header: {
                title: {
                  tag: 'plain_text',
                  content: '🚨 CẢNH BÁO 19:00: FANPAGE CHƯA ĐẠT CHỈ TIÊU BÀI ĐĂNG',
                },
                template: 'red',
              },
              elements: cardElements,
            },
          };
        } else {
          payload = {
            msg_type: 'interactive',
            card: {
              header: {
                title: {
                  tag: 'plain_text',
                  content: '🎉 BÁO CÁO 19:00: TẤT CẢ FANPAGE ĐÃ ĐẠT CHỈ TIÊU!',
                },
                template: 'green',
              },
              elements: [
                {
                  tag: 'div',
                  text: {
                    tag: 'lark_md',
                    content: `📅 **Ngày:** ${targetDate}\n👏 Tất cả 5 nhân sự được theo dõi đều đã hoàn thành xuất sắc chỉ tiêu đăng bài hôm nay (> 1 bài/page)!`,
                  },
                },
              ],
            },
          };
        }

        const larkRes = await fetch(LARK_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        larkSent = larkRes.ok;
        if (!larkRes.ok) {
          larkError = await larkRes.text();
        }
      } catch (err) {
        larkError = err.message;
      }
    }

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      targetDate,
      dailyTargetPosts: DAILY_TARGET_POSTS,
      totalActivePagesChecked: staffAssignments.length,
      warnedStaffCount: staffWithWarnings.length,
      larkWebhookConfigured: !!LARK_WEBHOOK_URL,
      larkSent,
      larkError,
      data: staffWithWarnings,
    });
  } catch (error) {
    console.error('Lỗi Cron Check Fanpage:', error);
    res.status(500).json({ error: error.message });
  }
});

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`🚀 CRM Fanpage Server is running at http://localhost:${PORT}`);
  });
}

module.exports = app;
