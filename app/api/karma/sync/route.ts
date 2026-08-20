import { NextResponse } from 'next/server';

export interface KarmaSyncReportItem {
  pageName?: string;
  page_name?: string;
  name?: string;
  Profile?: string;
  page?: string;

  pageId?: string;
  page_id?: string;
  profileId?: string;
  'Profile-ID'?: string;
  id?: string;

  numberOfPosts?: number | string;
  number_of_posts?: number | string;
  postCount?: number | string;
  post_count?: number | string;
  posts?: number | string;
  'Number of posts'?: number | string;

  views?: number | string;
  dailyViews?: number | string;
  daily_views?: number | string;
  'Daily Views'?: number | string;
  'Reach per day'?: number | string;

  followers?: number | string;
  follower?: number | string;
  'Follower'?: number | string;

  er?: number | string;
  engagementRate?: number | string;
  engagement_rate?: number | string;
  'Post interaction rate'?: number | string;

  interactions?: number | string;
  'Number of Likes'?: number | string;
  likes?: number | string;

  updatedDate?: string;
  report_date?: string;
  date?: string;

  avatarUrl?: string;
  avatar_url?: string;
  imageLink?: string;
  'Image Link'?: string;

  pageUrl?: string;
  page_url?: string;
  link?: string;
  Link?: string;

  category?: string;
  staffName?: string;
  staff_name?: string;
  topic?: string;
}

function normalizeDateString(dateStr: any): string {
  if (!dateStr) return new Date().toISOString().split('T')[0];
  dateStr = String(dateStr).trim();
  
  if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(dateStr)) {
    const parts = dateStr.split(/[-/]/);
    const y = parts[0];
    const m = parts[1].padStart(2, '0');
    const d = parts[2].padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

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

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    
    // Support multiple formats: { date, reports }, { date, data }, or raw array
    const rawReports: KarmaSyncReportItem[] = Array.isArray(body)
      ? body
      : (body.reports || body.data || body.items || []);
      
    const rawDate: string = body.date || body.reportDate || (rawReports[0]?.updatedDate || rawReports[0]?.date) || new Date().toISOString().split('T')[0];
    const syncDate: string = normalizeDateString(rawDate);

    if (!Array.isArray(rawReports) || rawReports.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'Không tìm thấy danh sách báo cáo (reports) trong dữ liệu gửi lên.',
      }, { status: 400 });
    }

    // Connect to SQLite Database
    const { db } = require('../../../../../db.js');

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

    const runSyncTransaction = db.transaction((items: KarmaSyncReportItem[]) => {
      for (const item of items) {
        const pageName = (item.pageName || item.page_name || item.name || item.Profile || item.page || '').trim();
        if (!pageName) continue;

        const pageId = (item.pageId || item.page_id || item.profileId || item['Profile-ID'] || item.id || '').trim();
        const itemDate = item.updatedDate || item.report_date || item.date;
        const reportDate = itemDate ? normalizeDateString(itemDate) : syncDate;
        
        const views = parseInt(String(item.views || item.dailyViews || item.daily_views || item['Daily Views'] || item['Reach per day'] || 0), 10) || 0;
        const postCount = parseInt(String(item.numberOfPosts || item.number_of_posts || item.postCount || item.post_count || item.posts || item['Number of posts'] || 0), 10) || 0;
        const postsPerDay = postCount;
        const followers = parseInt(String(item.followers || item.follower || item['Follower'] || 0), 10) || 0;
        const engagementRate = parseFloat(String(item.er || item.engagementRate || item.engagement_rate || item['Post interaction rate'] || 0)) || 0;
        const interactions = parseInt(String(item.interactions || item['Number of Likes'] || item.likes || 0), 10) || 0;
        
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

    console.log(`[Karma Sync] Đã lưu thành công ${savedCount} trang ngày ${syncDate} vào CRM!`);

    return NextResponse.json({
      success: true,
      message: `Đã lưu thành công ${savedCount} trang ngày ${syncDate} vào CRM!`,
      received: rawReports.length,
      synced: savedCount,
      date: syncDate,
    }, {
      headers: {
        'Access-Control-Allow-Origin': '*',
      }
    });
  } catch (error: any) {
    console.error('[Karma Sync Error]:', error);
    try {
      const { db } = require('../../../../../db.js');
      db.prepare(`
        INSERT INTO webhook_logs (sender_email, status, record_count, message, raw_payload)
        VALUES (?, 'ERROR', 0, ?, ?)
      `).run(
        'Chrome Extension',
        `Lỗi đồng bộ: ${error.message}`,
        JSON.stringify(error).substring(0, 1000)
      );
    } catch (e) {}
    return NextResponse.json({ success: false, error: error.message }, { 
      status: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
      }
    });
  }
}

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    message: 'Karma Sync API endpoint is active and ready to accept POST requests with { date, reports } from Chrome Extension.',
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
  }, {
    headers: {
      'Access-Control-Allow-Origin': '*',
    }
  });
}
