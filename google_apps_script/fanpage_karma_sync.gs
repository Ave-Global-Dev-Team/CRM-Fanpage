/**
 * GOOGLE APPS SCRIPT: TỰ ĐỘNG ĐỒNG BỘ BÁO CÁO FANPAGE KARMA VỀ CRM NỘI BỘ
 * --------------------------------------------------------------------------
 * Email tài khoản: maiduc2311@gmail.com
 * Tác vụ: Đọc email báo cáo định kỳ từ Fanpage Karma -> Trích xuất số liệu -> Đẩy vào CRM
 * --------------------------------------------------------------------------
 */

// CẤU HÌNH HỆ THỐNG
const CONFIG = {
  // Điền URL Webhook của CRM nội bộ (Khi chạy qua CloudFlare Tunnel/Ngrok hoặc Server triển khai)
  // Mặc định chạy local test qua Ngrok hoặc IP Server của bạn
  CRM_WEBHOOK_URL: 'http://localhost:3300/api/webhook/fanpagekarma', 
  
  // API Key bí mật để xác thực với CRM
  API_KEY: 'crm_karma_secret_token_2026',
  
  // Email người gửi từ Fanpage Karma
  SENDER_QUERY: 'from:fanpagekarma.com',
  
  // Nhãn Gmail để đánh dấu thư đã xử lý (tránh xử lý trùng lặp)
  PROCESSED_LABEL: 'FanpageKarma/Da_Dong_Bo_CRM'
};

/**
 * HÀM CHÍNH: Chạy tự động quét email và gửi số liệu sang CRM
 */
function syncFanpageKarmaReportToCRM() {
  Logger.log('🚀 Bắt đầu quét email báo cáo từ Fanpage Karma...');
  
  // Tạo hoặc lấy nhãn Gmail đã xử lý
  const processedLabel = getOrCreateLabel(CONFIG.PROCESSED_LABEL);
  
  // Tìm kiếm email mới từ Fanpage Karma chưa được gắn nhãn đã xử lý
  const searchQuery = `${CONFIG.SENDER_QUERY} has:attachment -label:${CONFIG.PROCESSED_LABEL}`;
  const threads = GmailApp.search(searchQuery, 0, 5); // Quét 5 chuỗi thư gần nhất
  
  if (threads.length === 0) {
    Logger.log('ℹ️ Không có email báo cáo mới nào cần xử lý.');
    return;
  }
  
  let totalProcessedRecords = 0;
  
  for (let t = 0; t < threads.length; t++) {
    const messages = threads[t].getMessages();
    const latestMsg = messages[messages.length - 1];
    const attachments = latestMsg.getAttachments();
    const msgDate = Utilities.formatDate(latestMsg.getDate(), 'Asia/Ho_Chi_Minh', 'yyyy-MM-dd');
    
    Logger.log(`📧 Tìm thấy thư ngày: ${msgDate} | Tiêu đề: ${latestMsg.getSubject()}`);
    
    let extractedRows = [];
    
    for (let a = 0; a < attachments.length; a++) {
      const att = attachments[a];
      const fileName = att.getName().toLowerCase();
      
      if (fileName.endsWith('.csv')) {
        extractedRows = extractedRows.concat(parseCSVAttachment(att, msgDate));
      } else if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
        extractedRows = extractedRows.concat(parseExcelAttachment(att, msgDate));
      }
    }
    
    // Nếu có dữ liệu trích xuất được
    if (extractedRows.length > 0) {
      const payload = {
        sender: 'maiduc2311@gmail.com',
        report_date: msgDate,
        records: extractedRows
      };
      
      // Gửi sang CRM Webhook
      const success = sendDataToCRM(payload);
      if (success) {
        // Gắn nhãn đã xử lý
        threads[t].addLabel(processedLabel);
        totalProcessedRecords += extractedRows.length;
        Logger.log(`✅ Đã đồng bộ thành công ${extractedRows.length} trang từ thư này sang CRM.`);
      }
    } else {
      Logger.log(`⚠️ Không tìm thấy file CSV/Excel hợp lệ trong thư.`);
    }
  }
  
  Logger.log(`🎉 Hoàn tất quá trình đồng bộ! Tổng số bản ghi đã nạp: ${totalProcessedRecords}`);
}

/**
 * Xử lý file đính kèm dạng CSV
 */
function parseCSVAttachment(attachment, defaultDate) {
  const records = [];
  try {
    const csvContent = attachment.getDataAsString('UTF-8');
    const parsedData = Utilities.parseCsv(csvContent);
    
    if (parsedData.length < 2) return records;
    
    const headers = parsedData[0].map(h => normalizeHeader(h));
    
    for (let r = 1; r < parsedData.length; r++) {
      const row = parsedData[r];
      if (row.length === 0 || !row[0]) continue;
      
      const record = mapRowToSchema(headers, row, defaultDate);
      if (record && record.page_name) {
        records.push(record);
      }
    }
  } catch (err) {
    Logger.log(`❌ Lỗi khi đọc file CSV: ${err.message}`);
  }
  return records;
}

/**
 * Xử lý file đính kèm dạng Excel (.xlsx) thông qua Google Drive tạm
 */
function parseExcelAttachment(attachment, defaultDate) {
  const records = [];
  try {
    // Chuyển đổi Excel tạm thời sang Google Sheets để đọc dữ liệu
    const tempBlob = attachment.copyBlob();
    const tempFile = Drive.Files.insert(
      { title: 'temp_karma_' + new Date().getTime(), mimeType: MimeType.GOOGLE_SHEETS },
      tempBlob,
      { convert: true }
    );
    
    const ss = SpreadsheetApp.openById(tempFile.id);
    const sheet = ss.getSheets()[0];
    const data = sheet.getDataRange().getValues();
    
    if (data.length >= 2) {
      const headers = data[0].map(h => normalizeHeader(String(h)));
      for (let r = 1; r < data.length; r++) {
        const row = data[r];
        if (!row[0]) continue;
        const record = mapRowToSchema(headers, row, defaultDate);
        if (record && record.page_name) {
          records.push(record);
        }
      }
    }
    
    // Xóa file tạm trên Drive
    Drive.Files.remove(tempFile.id);
  } catch (err) {
    Logger.log(`ℹ️ Đọc Excel trực tiếp (cần kích hoạt Google Drive API service nếu dùng xlsx): ${err.message}`);
  }
  return records;
}

/**
 * Ánh xạ linh hoạt các cột của Fanpage Karma về cấu trúc chuẩn của CRM
 */
function mapRowToSchema(headers, row, defaultDate) {
  const getCol = (possibleNames) => {
    for (let i = 0; i < headers.length; i++) {
      for (const name of possibleNames) {
        if (headers[i].includes(name)) return row[i];
      }
    }
    return null;
  };
  
  const pageName = getCol(['page', 'fanpage', 'name', 'profile', 'trang', 'tên']);
  if (!pageName) return null;
  
  const pageIdVal = getCol(['profileid', 'profile-id', 'pageid', 'profile_id', 'id']);
  const linkVal = getCol(['link', 'urllink', 'url', 'profilelink']);

  let pageId = '';
  let pageUrl = '';
  if (pageIdVal && String(pageIdVal).trim() !== '') {
    pageId = String(pageIdVal).trim();
    pageUrl = 'https://facebook.com/' + pageId;
  } else if (linkVal && String(linkVal).trim() !== '') {
    pageUrl = String(linkVal).trim();
  }

  const viewsVal = getCol(['dailyviews', 'views', 'view', 'lượt xem', 'videoview', 'impression']);
  const postsPerDayVal = getCol(['postsperday', 'posts/day', 'bài/ngày', 'postperday', 'frequency', 'tần suất', 'anzahlposts']);
  const postCountVal = getCol(['numberofposts', 'posts', 'bài đăng', 'postcount', 'số bài', 'anzahl_posts']);
  const interactionsVal = getCol(['totalinteractions', 'interactions', 'tương tác', 'engagement', 'reaction']);
  const erVal = getCol(['postinteractionrate', 'interactionrate', 'engagementrate', 'tỷ lệ tương tác', 'er', 'engrate']);
  const followersVal = getCol(['follower', 'followers', 'fan', 'người theo dõi', 'likes', 'fans']);
  
  return {
    page_name: String(pageName).trim(),
    page_id: pageId,
    page_url: pageUrl,
    report_date: defaultDate,
    views: parseInt(viewsVal || 0, 10) || 0,
    posts_per_day: parseFloat(postsPerDayVal || 0) || 0,
    post_count: parseInt(postCountVal || 0, 10) || 0,
    interactions: parseInt(interactionsVal || 0, 10) || 0,
    engagement_rate: parseFloat(erVal || 0) || 0,
    followers: parseInt(followersVal || 0, 10) || 0,
    source: 'Google Apps Script (Email Sync)'
  };
}

function normalizeHeader(str) {
  return String(str).toLowerCase().replace(/[\s_\-\.\/]/g, '');
}

/**
 * Gửi HTTP Request sang CRM Webhook
 */
function sendDataToCRM(payload) {
  const url = CONFIG.CRM_WEBHOOK_URL;
  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'Authorization': 'Bearer ' + CONFIG.API_KEY
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };
  
  try {
    const response = UrlFetchApp.fetch(url, options);
    const code = response.getResponseCode();
    const content = response.getContentText();
    
    if (code === 200) {
      Logger.log(`📡 CRM Webhook phản hồi: ${content}`);
      return true;
    } else {
      Logger.log(`❌ CRM Webhook lỗi [HTTP ${code}]: ${content}`);
      return false;
    }
  } catch (err) {
    Logger.log(`❌ Không thể kết nối tới CRM Webhook: ${err.message}`);
    return false;
  }
}

/**
 * Lấy hoặc tạo mới nhãn Gmail
 */
function getOrCreateLabel(labelName) {
  let label = GmailApp.getUserLabelByName(labelName);
  if (!label) {
    label = GmailApp.createLabel(labelName);
  }
  return label;
}

/**
 * HÀM TEST THỬ KẾT NỐI (Chạy thử hàm này để kiểm tra Webhook CRM)
 */
function testSendSampleData() {
  const today = Utilities.formatDate(new Date(), 'Asia/Ho_Chi_Minh', 'yyyy-MM-dd');
  const samplePayload = {
    sender: 'maiduc2311@gmail.com',
    report_date: today,
    records: [
      {
        page_name: 'Fanpage Bán Hàng 01 (Test GAS)',
        views: 24500,
        posts_per_day: 3.2,
        post_count: 7,
        interactions: 890,
        engagement_rate: 3.63,
        followers: 130000,
        source: 'Google Apps Script (Test)'
      },
      {
        page_name: 'Fanpage Đối Thủ A (Test GAS)',
        views: 19800,
        posts_per_day: 2.0,
        post_count: 4,
        interactions: 520,
        engagement_rate: 2.62,
        followers: 95000,
        source: 'Google Apps Script (Test)'
      }
    ]
  };
  
  Logger.log('🧪 Đang gửi gói dữ liệu mẫu sang CRM...');
  const res = sendDataToCRM(samplePayload);
  if (res) {
    Logger.log('✅ TEST THÀNH CÔNG! Kiểm tra giao diện CRM để xem số liệu.');
  } else {
    Logger.log('❌ TEST THẤT BẠI. Hãy kiểm tra URL Webhook và API Key trong CONFIG.');
  }
}

/**
 * TẠO LỊCH CHẠY TỰ ĐỘNG MỖI NGÀY (Vào 7:00 - 8:00 sáng)
 */
function createDailyTrigger() {
  // Xóa các trigger cũ nếu có
  const triggers = ScriptApp.getProjectTriggers();
  for (let i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'syncFanpageKarmaReportToCRM') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  
  // Tạo trigger mới chạy lúc 7h sáng mỗi ngày
  ScriptApp.newTrigger('syncFanpageKarmaReportToCRM')
    .timeBased()
    .everyDays(1)
    .atHour(7)
    .create();
    
  Logger.log('⏰ Đã cài đặt lịch tự động quét email mỗi ngày vào 7h sáng!');
}
