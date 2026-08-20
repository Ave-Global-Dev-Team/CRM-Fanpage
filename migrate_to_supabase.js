const { createClient } = require('@supabase/supabase-js');
const { db } = require('./db.js');

const supabaseUrl = process.env.SUPABASE_URL || 'https://eotcqkgfddvudzcbavaw.supabase.co';
const supabaseKey = process.env.SUPABASE_KEY || 'sb_secret_Z54UkXInHPqAAYZXM02-8A_Ejucg2Tq';

const supabase = createClient(supabaseUrl, supabaseKey);

async function migrate() {
  console.log('🚀 Bắt đầu quá trình đồng bộ dữ liệu từ SQLite sang Supabase...');

  try {
    // 1. Migrate Staff
    const staffRows = db.prepare("SELECT * FROM staff WHERE name != 'Chưa phân bổ'").all();
    console.log(`Đang đồng bộ ${staffRows.length} nhân sự...`);
    if (staffRows.length > 0) {
      const { error } = await supabase.from('staff').upsert(
        staffRows.map(r => ({
          name: r.name,
          code: r.code,
          department: r.department || 'Aff Decor',
          role: r.role || 'staff',
          password: r.password || '123456'
        })),
        { onConflict: 'name' }
      );
      if (error) console.error('Lỗi sync staff:', error);
      else console.log('✅ Đã đồng bộ xong bảng staff!');
    }

    // 2. Migrate Master Pages
    const masterRows = db.prepare("SELECT * FROM master_pages").all();
    console.log(`Đang đồng bộ ${masterRows.length} phân bổ fanpage...`);
    if (masterRows.length > 0) {
      // Chunk into batches of 200
      for (let i = 0; i < masterRows.length; i += 200) {
        const chunk = masterRows.slice(i, i + 200).map(r => ({
          page_name: r.page_name,
          page_id: r.page_id || '',
          staff_name: r.staff_name,
          department: r.department || '',
          topic: r.topic || 'Chưa phân loại',
          bm: r.bm || '',
          workflow: r.workflow || '',
          status: r.status || 'Active',
          note: r.note || ''
        }));
        const { error } = await supabase.from('master_pages').insert(chunk);
        if (error) console.error('Lỗi sync master_pages batch:', error);
      }
      console.log('✅ Đã đồng bộ xong bảng master_pages!');
    }

    // 3. Migrate Pages
    const pageRows = db.prepare("SELECT * FROM pages WHERE name NOT IN ('Chưa phân loại')").all();
    console.log(`Đang đồng bộ ${pageRows.length} fanpages...`);
    if (pageRows.length > 0) {
      for (let i = 0; i < pageRows.length; i += 200) {
        const chunk = pageRows.slice(i, i + 200).map(r => ({
          name: r.name,
          page_id: r.page_id || '',
          page_url: r.page_url || '',
          category: r.category || 'Của tôi',
          avatar_url: r.avatar_url || '',
          staff_name: r.staff_name || 'Chưa phân bổ',
          topic: r.topic || 'Chưa phân loại'
        }));
        const { error } = await supabase.from('pages').insert(chunk);
        if (error) console.error('Lỗi sync pages batch:', error);
      }
      console.log('✅ Đã đồng bộ xong bảng pages!');
    }

    // 4. Migrate Daily Metrics
    const metricRows = db.prepare("SELECT * FROM daily_metrics").all();
    console.log(`Đang đồng bộ ${metricRows.length} bản ghi báo cáo chỉ số ngày...`);
    if (metricRows.length > 0) {
      for (let i = 0; i < metricRows.length; i += 200) {
        const chunk = metricRows.slice(i, i + 200).map(r => ({
          page_name: r.page_name,
          report_date: r.report_date,
          views: r.views || 0,
          posts_per_day: r.posts_per_day || 0,
          post_count: r.post_count || 0,
          interactions: r.interactions || 0,
          engagement_rate: r.engagement_rate || 0,
          followers: r.followers || 0,
          source: r.source || 'Manual Sync',
          raw_data: r.raw_data ? JSON.parse(r.raw_data) : null
        }));
        const { error } = await supabase.from('daily_metrics').upsert(chunk, { onConflict: 'page_name,report_date' });
        if (error) console.error('Lỗi sync daily_metrics batch:', error);
      }
      console.log('✅ Đã đồng bộ xong bảng daily_metrics!');
    }

    // 5. Migrate App Settings
    const settingRows = db.prepare("SELECT * FROM app_settings").all();
    if (settingRows.length > 0) {
      await supabase.from('app_settings').upsert(settingRows.map(r => ({ key: r.key, value: r.value })), { onConflict: 'key' });
      console.log('✅ Đã đồng bộ xong bảng app_settings!');
    }

    console.log('🎉 TOÀN BỘ DỮ LIỆU ĐÃ ĐƯỢC CHUYỂN LÊN SUPABASE THÀNH CÔNG!');
  } catch (err) {
    console.error('❌ Lỗi di chuyển dữ liệu:', err);
  }
}

migrate();
