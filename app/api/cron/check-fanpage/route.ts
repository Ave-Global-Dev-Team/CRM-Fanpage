import { NextResponse } from 'next/server';

// 1. Khai báo các Type dữ liệu dựa theo UI CRM
export interface StaffAssignment {
  pageId: string;
  pageName: string;
  staffName: string;
  staffLarkId?: string; // ID người dùng trên Lark để @mention (VD: ou_xxxxxx)
  status: 'Active' | 'Inactive';
  topic?: string;
}

export interface FanpageReport {
  pageId: string;
  pageName: string;
  postsToday: number; // Số bài đăng trong ngày (hoặc chỉ số Number of posts)
  views?: number;
  staffName?: string;
  updatedDate: string;
}

export interface PageWarning {
  pageId: string;
  pageName: string;
  postsToday: number;
  target: number;
  missingPosts: number;
}

export interface StaffWarningReport {
  staffName: string;
  staffLarkId?: string;
  totalPages: number;
  completedPagesCount: number;
  warningPages: PageWarning[];
}

// 2. Cấu hình hằng số
const LARK_WEBHOOK_URL = process.env.LARK_WEBHOOK_URL || '';
const DAILY_TARGET_POSTS = 2; // Target 2 post / ngày / page

export async function GET(request: Request) {
  try {
    // (Bảo mật tùy chọn): Kiểm tra Cron Secret của Vercel
    const authHeader = request.headers.get('authorization');
    if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const url = new URL(request.url);
    const targetDate = url.searchParams.get('date') || new Date().toISOString().split('T')[0];

    // ------------------------------------------------------------------
    // BƯỚC 1: Lấy dữ liệu từ "Danh Sách Phân Bổ Nhân Sự + Fanpage"
    // ------------------------------------------------------------------
    const staffAssignments: StaffAssignment[] = await getStaffAssignmentsFromDB();

    // ------------------------------------------------------------------
    // BƯỚC 2: Lấy dữ liệu từ "Dashboard Báo Cáo Fanpage" hôm nay
    // ------------------------------------------------------------------
    const fanpageReports: FanpageReport[] = await getFanpageReportsTodayFromDB(targetDate);

    // ------------------------------------------------------------------
    // BƯỚC 3: AI Agent Đối Chiếu Dữ Liệu & Gom Nhóm Theo Nhân Sự
    // ------------------------------------------------------------------
    const staffReportMap = new Map<string, StaffWarningReport>();

    // Chỉ lấy các phân bổ đang ở trạng thái 'Active'
    const activeAssignments = staffAssignments.filter(a => a.status === 'Active');

    for (const assignment of activeAssignments) {
      const { staffName, staffLarkId, pageId, pageName } = assignment;
      const cleanStaffName = staffName || 'Chưa phân bổ';

      // Khởi tạo báo cáo cho nhân sự nếu chưa có
      if (!staffReportMap.has(cleanStaffName)) {
        staffReportMap.set(cleanStaffName, {
          staffName: cleanStaffName,
          staffLarkId,
          totalPages: 0,
          completedPagesCount: 0,
          warningPages: [],
        });
      }

      const staffReport = staffReportMap.get(cleanStaffName)!;
      staffReport.totalPages += 1;

      // Tìm báo cáo tương ứng của Page trong Dashboard Báo Cáo
      const report = fanpageReports.find(
        r => (pageId && r.pageId === pageId) || r.pageName.toLowerCase().trim() === pageName.toLowerCase().trim()
      );

      // Nếu không có báo cáo -> Coi như 0 bài đăng
      const postsToday = report ? Math.floor(report.postsToday) : 0;

      if (postsToday < DAILY_TARGET_POSTS) {
        // Chưa đạt target -> Đưa vào danh sách cảnh báo
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

    // Lọc ra các nhân sự có ít nhất 1 Page chưa đạt KPI
    const staffWithWarnings = Array.from(staffReportMap.values()).filter(
      s => s.warningPages.length > 0
    );

    // ------------------------------------------------------------------
    // BƯỚC 4: Nếu tất cả đều đạt KPI -> Báo thành công
    // ------------------------------------------------------------------
    if (staffWithWarnings.length === 0) {
      return NextResponse.json({
        success: true,
        message: '🎉 Tất cả nhân sự và Fanpage đều đã hoàn thành đủ chỉ tiêu 2 bài/ngày!',
        targetDate,
      });
    }

    // ------------------------------------------------------------------
    // BƯỚC 5: Gửi Thông Báo Dạng Interactive Card Về Nhóm Lark
    // ------------------------------------------------------------------
    if (LARK_WEBHOOK_URL) {
      await sendLarkGroupCard(staffWithWarnings, targetDate);
    }

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      targetDate,
      warnedStaffCount: staffWithWarnings.length,
      data: staffWithWarnings,
    });
  } catch (error: any) {
    console.error('Lỗi Cron Check Fanpage:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// ============================================================================
// HÀM TẠO CARD LARK INTERACTIVE VÀ GỬI VỀ NHÓM LARK
// ============================================================================
async function sendLarkGroupCard(staffReports: StaffWarningReport[], targetDate: string) {
  const cardElements: any[] = [
    {
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: `📅 **Ngày kiểm tra:** ${targetDate}\n🎯 **Chỉ tiêu:** ${DAILY_TARGET_POSTS} bài / page / ngày\n⚠️ Phát hiện **${staffReports.length} nhân sự** chưa hoàn thành chỉ tiêu bài đăng.`,
      },
    },
    { tag: 'hr' },
  ];

  // Xây dựng khối hiển thị cho từng nhân sự
  staffReports.forEach((staff, index) => {
    const mentionText = staff.staffLarkId ? `<at id="${staff.staffLarkId}"></at>` : '';
    
    // Tạo danh sách các Page bị thiếu bài của nhân sự này
    const pageListContent = staff.warningPages
      .map(p => {
        const badge = p.postsToday === 0 ? '🔴 **[0/2 bài]**' : '🟡 **[1/2 bài]**';
        return `   • ${badge} **${p.pageName}** *(ID: ${p.pageId || 'N/A'})* — Thiếu ${p.missingPosts} bài`;
      })
      .join('\n');

    cardElements.push({
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: `👤 **Nhân sự phụ trách:** **${staff.staffName}** ${mentionText}\n📊 **Tiến độ:** ${staff.completedPagesCount}/${staff.totalPages} Page đạt chỉ tiêu\n\n📌 **Danh sách Page chưa đủ bài:**\n${pageListContent}`,
      },
    });

    if (index < staffReports.length - 1) {
      cardElements.push({ tag: 'hr' });
    }
  });

  // Khối Nút bấm chuyển sang CRM
  cardElements.push(
    { tag: 'hr' },
    {
      tag: 'action',
      actions: [
        {
          tag: 'button',
          text: { tag: 'plain_text', content: '🔗 Mở CRM Kiểm Tra Ngay' },
          type: "primary",
          url: 'https://crm-fanpage.vercel.app/',
        },
      ],
    }
  );

  const payload = {
    msg_type: 'interactive',
    card: {
      header: {
        title: {
          tag: 'plain_text',
          content: '🚨 CẢNH BÁO KPI FANPAGE: CHƯA ĐẠT 2 POST/NGÀY',
        },
        template: 'red',
      },
      elements: cardElements,
    },
  };

  const res = await fetch(LARK_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error('Lỗi khi gửi webhook Lark:', errText);
  }
}

// ============================================================================
// HÀM FETCH DỮ LIỆU TỪ DATABASE CRM
// ============================================================================

async function getStaffAssignmentsFromDB(): Promise<StaffAssignment[]> {
  try {
    // Dynamic import better-sqlite3 or internal query if available
    const { db } = require('../../../../../db.js');
    const rows = db.prepare(`
      SELECT 
        COALESCE(page_id, '') as pageId,
        page_name as pageName,
        COALESCE(staff_name, 'Chưa phân bổ') as staffName,
        COALESCE(status, 'Active') as status,
        topic
      FROM master_pages
      WHERE status = 'Active' OR status IS NULL
    `).all();

    return rows.map((r: any) => ({
      pageId: r.pageId,
      pageName: r.pageName,
      staffName: r.staffName,
      status: (r.status === 'Inactive' ? 'Inactive' : 'Active') as 'Active' | 'Inactive',
      topic: r.topic,
    }));
  } catch (err) {
    // Fallback if sqlite module cannot load in edge runtime
    return [
      { pageId: '101867349714421', pageName: 'Vibrant Vibe Fitness', staffName: 'Nguyễn Anh Tú', status: 'Active' },
      { pageId: '109805142163303', pageName: 'Power Pulse Fitness', staffName: 'Nguyễn Anh Tú', status: 'Active' },
      { pageId: '111099872034128', pageName: 'Yoga Wisdom', staffName: 'Nguyễn Anh Tú', status: 'Active' },
      { pageId: '104945032657502', pageName: 'Natural Cleansing', staffName: 'Nguyễn Anh Tú', status: 'Active' },
      { pageId: '102186739610422', pageName: 'Fit Fusion Zone', staffName: 'Trương Thị Anh Nhung', status: 'Active' },
      { pageId: '268031806396310', pageName: 'Utopia Uplift Universe', staffName: 'Phạm Thị Thanh Nga', status: 'Active' },
    ];
  }
}

async function getFanpageReportsTodayFromDB(targetDate: string): Promise<FanpageReport[]> {
  try {
    const { db } = require('../../../../../db.js');
    const rows = db.prepare(`
      SELECT 
        d.page_name as pageName,
        COALESCE(p.page_id, '') as pageId,
        COALESCE(d.post_count, d.posts_per_day, 0) as postsToday,
        d.views,
        d.report_date as updatedDate
      FROM daily_metrics d
      LEFT JOIN pages p ON d.page_name = p.name
      WHERE d.report_date = ?
    `).all(targetDate);

    return rows.map((r: any) => ({
      pageId: r.pageId,
      pageName: r.pageName,
      postsToday: Number(r.postsToday || 0),
      views: Number(r.views || 0),
      updatedDate: r.updatedDate,
    }));
  } catch (err) {
    return [];
  }
}
