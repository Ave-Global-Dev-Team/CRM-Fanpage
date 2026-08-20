import { NextResponse } from 'next/server';

// 1. Khai báo các Type dữ liệu
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
  postsToday: number; // Số bài đăng trong ngày
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

// 2. Cấu hình hằng số & Danh sách 5 nhân sự được kiểm tra
const LARK_WEBHOOK_URL = process.env.LARK_WEBHOOK_URL || 'https://open.larksuite.com/open-apis/bot/v2/hook/0fd6adf8-b62f-4f3f-bc66-b9cc2d5c7c0a';
const DAILY_TARGET_POSTS = 1; // Mục tiêu: Ít nhất 1 bài / page / ngày

const TARGET_STAFF_MEMBERS = [
  'Châu Thị Anh Thư',
  'Bùi Thị Trúc Phương',
  'Phạm Thị Thanh Nga',
  'Lê Đình Vinh',
  'Trương Thị Anh Nhung',
];

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
    // BƯỚC 1: Lấy phân bổ và lọc CHỈ 5 nhân sự được chỉ định
    // ------------------------------------------------------------------
    const allAssignments: StaffAssignment[] = await getStaffAssignmentsFromDB();
    const staffAssignments = allAssignments.filter(a => 
      a.status === 'Active' && 
      TARGET_STAFF_MEMBERS.some(name => name.toLowerCase() === a.staffName.toLowerCase().trim())
    );

    // ------------------------------------------------------------------
    // BƯỚC 2: Lấy dữ liệu báo cáo Fanpage hôm nay
    // ------------------------------------------------------------------
    const fanpageReports: FanpageReport[] = await getFanpageReportsTodayFromDB(targetDate);

    // ------------------------------------------------------------------
    // BƯỚC 3: Đối Chiếu Dữ Liệu & Gom Nhóm Theo 5 Nhân Sự
    // ------------------------------------------------------------------
    const staffReportMap = new Map<string, StaffWarningReport>();

    // Khởi tạo sẵn cho cả 5 nhân sự để luôn theo dõi đủ
    for (const staffName of TARGET_STAFF_MEMBERS) {
      staffReportMap.set(staffName, {
        staffName,
        totalPages: 0,
        completedPagesCount: 0,
        warningPages: [],
      });
    }

    for (const assignment of staffAssignments) {
      const { staffName, staffLarkId, pageId, pageName } = assignment;
      const matchedKey = TARGET_STAFF_MEMBERS.find(n => n.toLowerCase() === staffName.toLowerCase().trim()) || staffName;

      if (!staffReportMap.has(matchedKey)) {
        staffReportMap.set(matchedKey, {
          staffName: matchedKey,
          staffLarkId,
          totalPages: 0,
          completedPagesCount: 0,
          warningPages: [],
        });
      }

      const staffReport = staffReportMap.get(matchedKey)!;
      staffReport.totalPages += 1;

      // Tìm báo cáo tương ứng của Page (ưu tiên Page ID trước)
      const report = (pageId ? fanpageReports.find(r => r.pageId && r.pageId.trim() === pageId.trim()) : null) 
                  || fanpageReports.find(r => r.pageName.toLowerCase().trim() === pageName.toLowerCase().trim());

      // Nếu không có báo cáo -> Coi như 0 bài
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

    // Lọc ra các nhân sự có Page chưa đạt chỉ tiêu (trên 1 bài/ngày)
    const staffWithWarnings = Array.from(staffReportMap.values()).filter(
      s => s.totalPages > 0 && s.warningPages.length > 0
    );

    // ------------------------------------------------------------------
    // BƯỚC 4: Nếu tất cả đều đạt chỉ tiêu
    // ------------------------------------------------------------------
    if (staffWithWarnings.length === 0) {
      if (LARK_WEBHOOK_URL) {
        await sendLarkSuccessCard(targetDate);
      }
      return NextResponse.json({
        success: true,
        message: '🎉 Tất cả 5 nhân sự đều đã hoàn thành chỉ tiêu đăng bài (trên 1 bài/ngày)!',
        targetDate,
      });
    }

    // ------------------------------------------------------------------
    // BƯỚC 5: Gửi Thông Báo Interactive Card Về Nhóm Lark
    // ------------------------------------------------------------------
    if (LARK_WEBHOOK_URL) {
      await sendLarkGroupCard(staffWithWarnings, targetDate);
    }

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      targetDate,
      targetStaffChecked: TARGET_STAFF_MEMBERS.length,
      warnedStaffCount: staffWithWarnings.length,
      data: staffWithWarnings,
    });
  } catch (error: any) {
    console.error('Lỗi Cron Check Fanpage:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// ============================================================================
// HÀM TẠO CARD LARK VÀ GỬI VỀ NHÓM LARK (17:00 HẰNG NGÀY)
// ============================================================================
async function sendLarkGroupCard(staffReports: StaffWarningReport[], targetDate: string) {
  const cardElements: any[] = [
    {
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: `📅 **Thời gian kiểm tra:** 17:00 ngày ${targetDate}\n🎯 **Chỉ tiêu:** Đăng ít nhất 1 bài / page / ngày\n⚠️ Phát hiện **${staffReports.length} nhân sự** chưa hoàn thành chỉ tiêu bài đăng hôm nay.`,
      },
    },
    { tag: 'hr' },
  ];

  staffReports.forEach((staff, index) => {
    const pageListContent = staff.warningPages
      .map(p => {
        const badge = p.postsToday === 0 ? '🔴 [0 bài]' : `🟡 [${p.postsToday} bài]`;
        return `   • ${badge} ${p.pageName}`;
      })
      .join('\n');

    cardElements.push({
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: `👤 **Nhân sự:** ${staff.staffName}\n${pageListContent}`,
      },
    });

    if (index < staffReports.length - 1) {
      cardElements.push({ tag: 'hr' });
    }
  });

  // Nút bấm chuyển sang CRM
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

  const payload = {
    msg_type: 'interactive',
    card: {
      header: {
        title: {
          tag: 'plain_text',
          content: '🚨 CẢNH BÁO 17:00: FANPAGE CHƯA ĐẠT CHỈ TIÊU BÀI ĐĂNG',
        },
        template: 'red',
      },
      elements: cardElements,
    },
  };

  await fetch(LARK_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

async function sendLarkSuccessCard(targetDate: string) {
  const payload = {
    msg_type: 'interactive',
    card: {
      header: {
        title: {
          tag: 'plain_text',
          content: '🎉 BÁO CÁO 17:00: TẤT CẢ FANPAGE ĐÃ ĐẠT CHỈ TIÊU!',
        },
        template: 'green',
      },
      elements: [
        {
          tag: 'div',
          text: {
            tag: 'lark_md',
            content: `📅 **Ngày:** ${targetDate}\n👏 Tất cả 5 nhân sự được theo dõi (**Châu Thị Anh Thư, Bùi Thị Trúc Phương, Phạm Thị Thanh Nga, Lê Đình Vinh, Trương Thị Anh Nhung**) đều đã hoàn thành xuất sắc chỉ tiêu đăng bài hôm nay!`,
          },
        },
      ],
    },
  };

  await fetch(LARK_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

// ============================================================================
// HÀM FETCH DỮ LIỆU TỪ DATABASE CRM
// ============================================================================
async function getStaffAssignmentsFromDB(): Promise<StaffAssignment[]> {
  try {
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
    return [];
  }
}

async function getFanpageReportsTodayFromDB(targetDate: string): Promise<FanpageReport[]> {
  try {
    const { db } = require('../../../../../db.js');
    const rows = db.prepare(`
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
