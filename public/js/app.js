// Global state
let charts = {};
let currentOverviewData = null;
let currentDaysFilter = 14;
let currentStartDate = '2026-08-20';
let currentEndDate = '2026-08-20';
let currentSelectedReportDate = '2026-08-20';
let tempStartDate = '2026-08-20';
let tempEndDate = '2026-08-20';
let availableReportDates = ['2026-08-20'];
let calViewYear = 2026;
let calViewMonth = 7; // August (0-indexed)

let currentUser = JSON.parse(localStorage.getItem('karma_crm_user')) || {
  name: 'Admin',
  role: 'admin',
  department: 'Ban Giám Đốc'
};

// DOM Elements
document.addEventListener('DOMContentLoaded', () => {
  initNavigation();
  initTheme();
  initAuthAndUserSwitcher();
  initEventListeners();
  initDateRangePicker();
  loadAllData();
  
  // Auto refresh every 60s
  setInterval(() => {
    loadOverviewData(currentDaysFilter);
    loadWebhookLogs();
  }, 60000);
});

// ----------------------------------------------------
// 1. NAVIGATION & TABS
// ----------------------------------------------------
function initNavigation() {
  const navItems = document.querySelectorAll('.nav-item');
  const tabContents = document.querySelectorAll('.tab-content');
  const pageTitle = document.getElementById('pageTitle');
  const pageSubtitle = document.getElementById('pageSubtitle');

  const titles = {
    overview: {
      title: 'Tổng quan & Phân tích Chỉ số Fanpage',
      sub: 'Theo dõi Views, Tần suất bài đăng (Posts/day), Tương tác & So sánh đối thủ'
    },
    pages: {
      title: 'Dashboard Báo Cáo Fanpage',
      sub: 'Bảng xếp hạng hiệu suất Fanpage Karma, phân tích chỉ số và nạp file báo cáo'
    },
    'top-content': {
      title: 'Top 100 Posts Overview & Phân Tích Nội Dung',
      sub: 'Theo dõi bài viết Viral, Tương tác (Likes, Comments, Shares), ER và Sentiment'
    },
    topics: {
      title: 'Phân Tích & Đánh Giá Hiệu Quả Chủ Đề',
      sub: 'Tổng hợp Views, Tốc độ tăng trưởng, Tần suất đăng (Posts/day) và Xếp loại hiệu quả theo từng chủ đề'
    },
    staff: {
      title: 'Danh Sách Nhân Sự + Fanpage',
      sub: 'Đối chiếu Fanpage báo cáo với danh sách phân bổ theo từng nhân sự phụ trách'
    },
    history: {
      title: 'Lịch Sử Báo Cáo Chi Tiết Theo Ngày',
      sub: 'Dữ liệu tổng hợp từ Fanpage Karma qua Google Apps Script'
    },
    upload: {
      title: 'Nạp File Dữ Liệu Báo Cáo Thủ Công',
      sub: 'Kéo thả file Excel (.xlsx) hoặc CSV xuất từ Fanpage Karma'
    },
    webhook: {
      title: 'Cấu Hình Google Apps Script & Webhook',
      sub: 'Tự động hóa đọc email từ maiduc2311@gmail.com và đẩy dữ liệu về CRM'
    }
  };

  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const tab = item.getAttribute('data-tab');
      
      navItems.forEach(n => n.classList.remove('active'));
      tabContents.forEach(c => c.classList.remove('active'));

      item.classList.add('active');
      const targetTab = document.getElementById(`tab-${tab}`);
      if (targetTab) targetTab.classList.add('active');

      if (titles[tab]) {
        pageTitle.innerText = titles[tab].title;
        pageSubtitle.innerText = titles[tab].sub;
      }

      // Tab specific refresh
      if (tab === 'pages') loadPagesTable();
      if (tab === 'top-content') loadTopContentData();
      if (tab === 'topics') loadTopicsData();
      if (tab === 'staff') { loadStaffData(); loadMasterPagesTable(); }
      if (tab === 'history') loadHistoryTable();
      if (tab === 'webhook') { loadSettings(); loadWebhookLogs(); }
    });
  });
}

// ----------------------------------------------------
// 0. AUTH & USER PROFILE SWITCHER
// ----------------------------------------------------
let availableUsers = [];

function initAuthAndUserSwitcher() {
  const loginModal = document.getElementById('loginModalScreen');
  const userSwitchModal = document.getElementById('userSwitchModal');

  // Load user accounts for dropdowns & pills
  loadUserAccounts();

  // Check login state
  const savedUser = localStorage.getItem('karma_crm_user');
  if (!savedUser) {
    loginModal.classList.add('active');
  } else {
    try {
      currentUser = JSON.parse(savedUser);
    } catch (e) {
      currentUser = null;
      loginModal.classList.add('active');
    }
  }

  updateUserHeaderDisplay();

  // Switcher modal trigger (Admin only)
  document.getElementById('btnUserSwitcher')?.addEventListener('click', () => {
    if (!currentUser || currentUser.role !== 'admin') {
      showToast(`Tài khoản hiện tại: ${currentUser?.name || 'Nhân sự'}. Bạn không thể chuyển sang tài khoản người khác. Vui lòng Đăng Xuất nếu muốn đổi.`);
      return;
    }
    loadUserAccounts();
    userSwitchModal.classList.add('active');
  });
  document.getElementById('btnCloseUserSwitchModal')?.addEventListener('click', () => {
    userSwitchModal.classList.remove('active');
  });

  // Logout button
  document.getElementById('btnLogout')?.addEventListener('click', () => {
    if (confirm('Bạn có muốn đăng xuất khỏi tài khoản hiện tại?')) {
      localStorage.removeItem('karma_crm_user');
      currentUser = null;
      loginModal.classList.add('active');
      document.getElementById('loginForm')?.reset();
      document.getElementById('loginPasswordInput').value = '';
      document.getElementById('loginErrorMsg').style.display = 'none';
      loadUserAccounts();
    }
  });

  // Toggle Password
  const passInput = document.getElementById('loginPasswordInput');
  const btnToggle = document.getElementById('btnTogglePassword');
  btnToggle?.addEventListener('click', () => {
    if (passInput.type === 'password') {
      passInput.type = 'text';
      btnToggle.innerHTML = '<i class="fa-solid fa-eye-slash"></i>';
    } else {
      passInput.type = 'password';
      btnToggle.innerHTML = '<i class="fa-regular fa-eye"></i>';
    }
  });

  // Login User Select change
  document.getElementById('loginUserSelect')?.addEventListener('change', (e) => {
    if (e.target.value) {
      document.getElementById('loginUsernameInput').value = e.target.value;
      document.getElementById('loginPasswordInput').value = '';
      document.getElementById('loginPasswordInput').focus();
    }
  });

  // Login Form submit
  document.getElementById('loginForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById('loginErrorMsg');
    const submitBtn = document.getElementById('btnLoginSubmit');
    errorEl.style.display = 'none';

    const username = (document.getElementById('loginUserSelect')?.value || '').trim();
    const password = document.getElementById('loginPasswordInput').value;

    if (!username) {
      errorEl.innerText = 'Vui lòng chọn tài khoản nhân sự từ danh sách.';
      errorEl.style.display = 'block';
      return;
    }

    if (!password) {
      errorEl.innerText = 'Vui lòng nhập mật khẩu cá nhân.';
      errorEl.style.display = 'block';
      return;
    }

    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang xác thực...';

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<i class="fa-solid fa-right-to-bracket"></i> Đăng Nhập Làm Việc';

      if (data.success) {
        currentUser = data.user;
        localStorage.setItem('karma_crm_user', JSON.stringify(currentUser));
        loginModal.classList.remove('active');
        updateUserHeaderDisplay();
        showToast(`Chào mừng ${currentUser.name} đã đăng nhập thành công!`);
        loadAllData();
      } else {
        errorEl.innerText = data.error || 'Đăng nhập thất bại.';
        errorEl.style.display = 'block';
      }
    } catch (err) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<i class="fa-solid fa-right-to-bracket"></i> Đăng Nhập Làm Việc';
      errorEl.innerText = 'Lỗi kết nối máy chủ: ' + err.message;
      errorEl.style.display = 'block';
    }
  });

  // Change Password Modal handlers
  const changePasswordModal = document.getElementById('changePasswordModal');
  const btnOpenCP = document.getElementById('btnOpenChangePasswordModal');
  const btnCloseCP = document.getElementById('btnCloseChangePasswordModal');
  const btnCancelCP = document.getElementById('btnCancelChangePasswordModal');
  const cpErrorEl = document.getElementById('cpErrorMsg');

  btnOpenCP?.addEventListener('click', () => {
    if (!currentUser || !currentUser.name) return;
    const dept = currentUser.department || (currentUser.role === 'admin' ? 'Ban Giám Đốc' : 'Nhân sự');
    document.getElementById('cpAccountName').value = `${currentUser.name} (${dept})`;
    document.getElementById('cpOldPassword').value = '';
    document.getElementById('cpNewPassword').value = '';
    document.getElementById('cpConfirmPassword').value = '';
    if (cpErrorEl) cpErrorEl.style.display = 'none';
    changePasswordModal.classList.add('active');
    document.getElementById('cpOldPassword').focus();
  });

  btnCloseCP?.addEventListener('click', () => changePasswordModal.classList.remove('active'));
  btnCancelCP?.addEventListener('click', () => changePasswordModal.classList.remove('active'));

  document.getElementById('changePasswordForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (cpErrorEl) cpErrorEl.style.display = 'none';

    const oldPassword = document.getElementById('cpOldPassword').value.trim();
    const newPassword = document.getElementById('cpNewPassword').value.trim();
    const confirmPassword = document.getElementById('cpConfirmPassword').value.trim();
    const submitBtn = document.getElementById('btnSubmitChangePassword');

    if (newPassword.length < 6) {
      if (cpErrorEl) {
        cpErrorEl.innerText = 'Mật khẩu mới phải có tối thiểu 6 ký tự.';
        cpErrorEl.style.display = 'block';
      } else {
        alert('Mật khẩu mới phải có tối thiểu 6 ký tự.');
      }
      return;
    }

    if (newPassword !== confirmPassword) {
      if (cpErrorEl) {
        cpErrorEl.innerText = 'Mật khẩu xác nhận không trùng khớp với mật khẩu mới.';
        cpErrorEl.style.display = 'block';
      } else {
        alert('Mật khẩu xác nhận không trùng khớp với mật khẩu mới.');
      }
      return;
    }

    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang lưu...';

    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: currentUser.name,
          oldPassword,
          newPassword,
          confirmPassword
        })
      });
      const data = await res.json();
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<i class="fa-solid fa-check"></i> Cập Nhật Mật Khẩu';

      if (data.success) {
        showToast('Đổi mật khẩu thành công! Hãy ghi nhớ mật khẩu mới của bạn.');
        changePasswordModal.classList.remove('active');
      } else {
        if (cpErrorEl) {
          cpErrorEl.innerText = data.error || 'Đổi mật khẩu thất bại.';
          cpErrorEl.style.display = 'block';
        } else {
          alert(data.error);
        }
      }
    } catch (err) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<i class="fa-solid fa-check"></i> Cập Nhật Mật Khẩu';
      if (cpErrorEl) {
        cpErrorEl.innerText = 'Lỗi kết nối: ' + err.message;
        cpErrorEl.style.display = 'block';
      } else {
        alert('Lỗi: ' + err.message);
      }
    }
  });
}

function updateUserHeaderDisplay() {
  if (!currentUser) return;

  const nameEl = document.getElementById('headerUserName');
  const roleEl = document.getElementById('headerUserRole');
  const avatarEl = document.getElementById('headerUserAvatar');
  const switcherBtn = document.getElementById('btnUserSwitcher');
  const chevronIcon = document.getElementById('headerUserChevron');

  if (nameEl) nameEl.innerText = currentUser.name;
  if (roleEl) {
    roleEl.innerText = currentUser.role === 'admin' ? '👑 Toàn quyền Admin' : `👤 Nhân sự (${currentUser.department || 'Content'})`;
  }
  if (avatarEl) {
    avatarEl.innerHTML = currentUser.role === 'admin' 
      ? '<i class="fa-solid fa-crown"></i>' 
      : '<i class="fa-solid fa-user-check"></i>';
  }

  if (switcherBtn) {
    if (currentUser.role === 'admin') {
      switcherBtn.style.cursor = 'pointer';
      switcherBtn.title = 'Nhấp để chuyển đổi tài khoản nhân sự (Quyền Admin)';
      if (chevronIcon) chevronIcon.style.display = 'inline-block';
    } else {
      switcherBtn.style.cursor = 'default';
      switcherBtn.title = `Tài khoản cá nhân: ${currentUser.name} (${currentUser.department || 'Nhân sự'})`;
      if (chevronIcon) chevronIcon.style.display = 'none';
    }
  }

  // Update page title/sub if staff
  const subTitle = document.getElementById('pageSubtitle');
  if (currentUser.role !== 'admin' && subTitle) {
    subTitle.innerText = `Không gian làm việc & Báo cáo riêng của nhân sự: ${currentUser.name}`;
  } else if (subTitle) {
    subTitle.innerText = 'Theo dõi Views, Tần suất bài đăng (Posts/day), Tương tác & So sánh đối thủ';
  }

  const isAdmin = currentUser.role === 'admin';

  // Hide or show Webhook tab based on role
  const webhookNavBtn = document.querySelector('.nav-item[data-tab="webhook"]');
  if (webhookNavBtn) {
    webhookNavBtn.style.display = isAdmin ? 'flex' : 'none';
  }

  // Hide or show Staff Tab KPI cards based on role (Admin only)
  const staffKpiGrid = document.getElementById('staffKpiGrid');
  if (staffKpiGrid) {
    staffKpiGrid.style.display = isAdmin ? 'grid' : 'none';
  }

  // Personal Staff KPI Bar (Horizontal bar displayed for non-admin staff)
  const staffPersonalKpiBar = document.getElementById('staffPersonalKpiBar');
  if (staffPersonalKpiBar) {
    staffPersonalKpiBar.style.display = !isAdmin ? 'grid' : 'none';
  }

  // Hide or show Staff Leaderboard Table (Admin only)
  const staffLeaderboardCard = document.getElementById('staffLeaderboardCard');
  if (staffLeaderboardCard) {
    staffLeaderboardCard.style.display = isAdmin ? 'block' : 'none';
  }

  // Full-width cards for Master and Leaderboard
  const masterPagesCard = document.getElementById('masterPagesCard');
  if (masterPagesCard) {
    masterPagesCard.className = 'glass-card span-12';
  }

  // Hide or show Add Staff button based on role
  const btnOpenAddStaffModal = document.getElementById('btnOpenAddStaffModal');
  if (btnOpenAddStaffModal) {
    btnOpenAddStaffModal.style.display = isAdmin ? 'inline-flex' : 'none';
  }

  // Hide or show Staff filter dropdowns across tabs (Admin only)
  const wrapperFilterPagesByStaff = document.getElementById('wrapperFilterPagesByStaff');
  if (wrapperFilterPagesByStaff) {
    wrapperFilterPagesByStaff.style.display = isAdmin ? 'flex' : 'none';
  }

  const filterPostsByStaff = document.getElementById('filterPostsByStaff');
  if (filterPostsByStaff) {
    filterPostsByStaff.style.display = isAdmin ? 'inline-block' : 'none';
  }
}

async function loadUserAccounts() {
  try {
    const res = await fetch('/api/auth/users');
    const json = await res.json();
    if (!json.success) return;

    availableUsers = json.data;

    // 1. Populate Login Screen Select
    const loginSelect = document.getElementById('loginUserSelect');
    if (loginSelect) {
      loginSelect.innerHTML = '<option value="">-- Chọn tài khoản nhân sự --</option>';
      availableUsers.forEach(u => {
        const opt = document.createElement('option');
        opt.value = u.name;
        opt.innerText = `${u.name} (${u.role === 'admin' ? '👑 Admin' : u.department || 'Nhân sự'})`;
        loginSelect.appendChild(opt);
      });
    }

    // 2. Populate Switcher Modal List (Admin only)
    const listEl = document.getElementById('userAccountList');
    if (!listEl) return;

    listEl.innerHTML = `
      <div class="user-account-item ${currentUser?.name === 'Admin' ? 'active' : ''}" onclick="selectUser('Admin', 'admin', 'Ban Giám Đốc')">
        <div class="acc-avatar"><i class="fa-solid fa-crown" style="color:#fbbf24"></i></div>
        <div style="flex:1;">
          <strong style="color:var(--text-main); font-size:14px;">Admin (Quản trị viên)</strong>
          <br><small style="color:var(--text-muted)">Toàn quyền xem tất cả Page, tất cả nhân sự và thiết lập Webhook</small>
        </div>
        ${currentUser?.name === 'Admin' ? '<i class="fa-solid fa-circle-check" style="color:var(--accent-blue)"></i>' : ''}
      </div>
    `;

    availableUsers.filter(u => u.name !== 'Admin').forEach(u => {
      const isSelected = currentUser?.name === u.name;
      const item = document.createElement('div');
      item.className = `user-account-item ${isSelected ? 'active' : ''}`;
      item.innerHTML = `
        <div class="acc-avatar"><i class="fa-solid fa-user"></i></div>
        <div style="flex:1;">
          <strong style="color:var(--text-main); font-size:14px;">${escapeHtml(u.name)}</strong>
          <br><small style="color:var(--accent-emerald)">Chỉ xem Fanpage & Danh sách gốc của ${escapeHtml(u.name)}</small>
        </div>
        ${isSelected ? '<i class="fa-solid fa-circle-check" style="color:var(--accent-blue)"></i>' : ''}
      `;
      item.onclick = () => selectUser(u.name, 'staff', u.department);
      listEl.appendChild(item);
    });
  } catch (err) {
    console.error('Failed to load user accounts:', err);
  }
}

function selectUser(name, role, department) {
  if (currentUser && currentUser.role !== 'admin') {
    alert('Bạn không có quyền chuyển sang tài khoản của nhân sự khác. Vui lòng Đăng Xuất nếu muốn đổi tài khoản.');
    return;
  }
  currentUser = { name, role, department };
  localStorage.setItem('karma_crm_user', JSON.stringify(currentUser));
  updateUserHeaderDisplay();
  document.getElementById('userSwitchModal')?.classList.remove('active');
  showToast(`Đã chuyển sang tài khoản: ${name}`);
  loadAllData();
}

// ----------------------------------------------------
// 2. THEME & EVENT LISTENERS
// ----------------------------------------------------
function initTheme() {
  const themeToggle = document.getElementById('themeToggle');
  const savedTheme = localStorage.getItem('karma_crm_theme') || 'dark';
  
  if (savedTheme === 'light') {
    document.body.classList.remove('dark-theme');
    document.body.classList.add('light-theme');
    themeToggle.innerHTML = '<i class="fa-solid fa-sun"></i>';
  }

  themeToggle.addEventListener('click', () => {
    if (document.body.classList.contains('dark-theme')) {
      document.body.classList.remove('dark-theme');
      document.body.classList.add('light-theme');
      themeToggle.innerHTML = '<i class="fa-solid fa-sun"></i>';
      localStorage.setItem('karma_crm_theme', 'light');
    } else {
      document.body.classList.remove('light-theme');
      document.body.classList.add('dark-theme');
      themeToggle.innerHTML = '<i class="fa-solid fa-moon"></i>';
      localStorage.setItem('karma_crm_theme', 'dark');
    }
    // Re-render charts with new theme colors
    if (currentOverviewData) renderCharts(currentOverviewData);
  });
}

function initEventListeners() {
  // Date selector dropdown
  document.getElementById('selectReportDate')?.addEventListener('change', (e) => {
    currentSelectedReportDate = e.target.value;
    loadOverviewData(currentDaysFilter);
    loadPagesTable();
    loadStaffData();
    showToast(`Đang hiển thị báo cáo ngày: ${currentSelectedReportDate}`);
  });

  // Refresh button
  document.getElementById('btnRefreshData').addEventListener('click', () => {
    loadAllData();
    showToast('Đã làm mới dữ liệu toàn hệ thống');
  });

  // Trend filter buttons (7, 14, 30 days)
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      currentDaysFilter = parseInt(e.target.getAttribute('data-days'));
      loadOverviewData(currentDaysFilter);
    });
  });

  // Modal handlers for Page
  const pageModal = document.getElementById('pageModal');
  document.getElementById('btnOpenAddPageModal').addEventListener('click', () => {
    pageModal.classList.add('active');
    document.getElementById('inputPageName').focus();
  });
  document.getElementById('btnCloseModal').addEventListener('click', () => pageModal.classList.remove('active'));
  document.getElementById('btnCancelModal').addEventListener('click', () => pageModal.classList.remove('active'));

  // Modal handlers for Staff
  const staffModal = document.getElementById('staffModal');
  document.getElementById('btnOpenAddStaffModal')?.addEventListener('click', () => {
    staffModal.classList.add('active');
    document.getElementById('inputStaffName').focus();
  });
  document.getElementById('btnCloseStaffModal')?.addEventListener('click', () => staffModal.classList.remove('active'));
  document.getElementById('btnCancelStaffModal')?.addEventListener('click', () => staffModal.classList.remove('active'));

  // Modal handlers for Master Page
  const masterModal = document.getElementById('masterModal');
  document.getElementById('btnOpenAddMasterModal')?.addEventListener('click', () => {
    masterModal.classList.add('active');
    document.getElementById('inputMasterPageName').focus();
  });
  document.getElementById('btnCloseMasterModal')?.addEventListener('click', () => masterModal.classList.remove('active'));
  document.getElementById('btnCancelMasterModal')?.addEventListener('click', () => masterModal.classList.remove('active'));

  // Import Master List File handler
  const masterFileInput = document.getElementById('masterFileInput');
  document.getElementById('btnImportMasterList')?.addEventListener('click', () => masterFileInput.click());
  masterFileInput?.addEventListener('change', handleMasterFileUpload);

  // Search Master Pages
  document.getElementById('searchMasterInput')?.addEventListener('input', () => {
    renderMasterPagesTable();
  });

  // Filter Pages by Staff
  document.getElementById('filterPagesByStaff')?.addEventListener('change', () => {
    renderSortedPagesTable();
  });

  // Add Page Form submit
  document.getElementById('addPageForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('inputPageName').value.trim();
    const topic = document.getElementById('inputPageTopic')?.value.trim() || 'Chưa phân loại';
    const category = document.getElementById('selectPageCategory').value;
    const page_url = document.getElementById('inputPageUrl').value.trim();

    try {
      const res = await fetch('/api/pages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, topic, category, page_url })
      });
      const data = await res.json();
      if (data.success) {
        showToast('Đã thêm Fanpage thành công!');
        pageModal.classList.remove('active');
        document.getElementById('addPageForm').reset();
        loadAllData();
      } else {
        alert(data.error);
      }
    } catch (err) {
      alert('Lỗi kết nối: ' + err.message);
    }
  });

  // Add Staff Form submit
  document.getElementById('addStaffForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('inputStaffName').value.trim();
    const code = document.getElementById('inputStaffCode').value.trim();
    const department = document.getElementById('inputStaffDepartment').value.trim();

    try {
      const res = await fetch('/api/staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, code, department })
      });
      const data = await res.json();
      if (data.success) {
        showToast(data.message);
        staffModal.classList.remove('active');
        document.getElementById('addStaffForm').reset();
        loadStaffData();
      } else {
        alert(data.error);
      }
    } catch (err) {
      alert('Lỗi: ' + err.message);
    }
  });

  // Add Master Page Form submit
  document.getElementById('addMasterForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const page_name = document.getElementById('inputMasterPageName').value.trim();
    const page_id = document.getElementById('inputMasterPageId').value.trim();
    const staff_name = document.getElementById('inputMasterStaffName').value.trim();
    const topic = document.getElementById('inputMasterTopic')?.value.trim() || 'Chưa phân loại';
    const bm = document.getElementById('inputMasterBm')?.value.trim() || '';
    const workflow = document.getElementById('inputMasterWorkflow')?.value.trim() || '';
    const status = document.getElementById('inputMasterStatus')?.value || 'Active';
    const department = document.getElementById('inputMasterDepartment').value.trim();
    const note = document.getElementById('inputMasterNote').value.trim();

    try {
      const res = await fetch('/api/master-pages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ page_name, page_id, staff_name, topic, bm, workflow, status, department, note })
      });
      const data = await res.json();
      if (data.success) {
        showToast(data.message);
        masterModal.classList.remove('active');
        document.getElementById('addMasterForm').reset();
        loadStaffData();
        loadMasterPagesTable();
        loadPagesTable();
        loadTopicsData();
      } else {
        alert(data.error);
      }
    } catch (err) {
      alert('Lỗi: ' + err.message);
    }
  });

  // Search in Pages table
  document.getElementById('searchPagesInput').addEventListener('input', () => {
    renderSortedPagesTable();
  });

  // Init Pages & History Sorting
  initPagesSorting();
  initHistorySorting();

  // History Filter Page select
  document.getElementById('filterHistoryPage').addEventListener('change', () => {
    loadHistoryTable();
  });

  // Export CSV
  document.getElementById('btnExportCSV').addEventListener('click', exportHistoryToCSV);

  // Upload Handlers
  initUploadHandlers();

  // Init Top Content
  initTopContentEventListeners();

  // Init Topics
  initTopicsEventListeners();

  // Refresh Webhook logs
  document.getElementById('btnRefreshLogs')?.addEventListener('click', () => {
    loadWebhookLogs();
    showToast('Đã cập nhật nhật ký Webhook');
  });
}

// ----------------------------------------------------
// 2.5 ADVANCED DATE RANGE PICKER (DUAL CALENDAR & PRESETS)
// ----------------------------------------------------
function initDateRangePicker() {
  const modal = document.getElementById('dateRangePickerModal');
  const triggerBtn = document.getElementById('btnOpenDateRangePicker');
  const cancelBtn = document.getElementById('btnCancelDateRange');
  const applyBtn = document.getElementById('btnApplyDateRange');
  const prevBtn = document.getElementById('calPrevBtn');
  const nextBtn = document.getElementById('calNextBtn');

  if (!modal || !triggerBtn) return;

  triggerBtn.addEventListener('click', () => {
    openDateRangePickerModal();
  });

  cancelBtn?.addEventListener('click', () => {
    modal.classList.remove('active');
  });

  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.classList.remove('active');
    }
  });

  applyBtn?.addEventListener('click', () => {
    applySelectedDateRange();
  });

  prevBtn?.addEventListener('click', () => {
    calViewMonth--;
    if (calViewMonth < 0) {
      calViewMonth = 11;
      calViewYear--;
    }
    renderDualCalendar();
  });

  nextBtn?.addEventListener('click', () => {
    calViewMonth++;
    if (calViewMonth > 11) {
      calViewMonth = 0;
      calViewYear++;
    }
    renderDualCalendar();
  });

  // Preset buttons
  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const rangeType = btn.getAttribute('data-range');
      selectPresetRange(rangeType);
    });
  });
}

function openDateRangePickerModal() {
  const modal = document.getElementById('dateRangePickerModal');
  if (!modal) return;

  tempStartDate = currentStartDate || '2026-08-20';
  tempEndDate = currentEndDate || '2026-08-20';

  if (tempStartDate) {
    const parts = tempStartDate.split('-');
    if (parts.length === 3) {
      calViewYear = parseInt(parts[0]);
      calViewMonth = parseInt(parts[1]) - 1;
    }
  }

  updateRangeInputsDisplay();
  renderDualCalendar();
  modal.classList.add('active');
}

function updateRangeInputsDisplay() {
  const startInp = document.getElementById('inputRangeStart');
  const endInp = document.getElementById('inputRangeEnd');
  if (startInp) startInp.value = tempStartDate || '';
  if (endInp) endInp.value = tempEndDate || tempStartDate || '';
}

const MONTH_NAMES_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function renderDualCalendar() {
  const y1 = calViewYear;
  const m1 = calViewMonth;
  const title1 = document.getElementById('calMonthTitle1');
  if (title1) title1.innerText = `${MONTH_NAMES_SHORT[m1]} ${y1}`;
  renderSingleMonthCalendar('calDaysGrid1', y1, m1);

  let y2 = y1;
  let m2 = m1 + 1;
  if (m2 > 11) {
    m2 = 0;
    y2++;
  }
  const title2 = document.getElementById('calMonthTitle2');
  if (title2) title2.innerText = `${MONTH_NAMES_SHORT[m2]} ${y2}`;
  renderSingleMonthCalendar('calDaysGrid2', y2, m2);
}

function formatDateStr(year, month, day) {
  const m = String(month + 1).padStart(2, '0');
  const d = String(day).padStart(2, '0');
  return `${year}-${m}-${d}`;
}

function renderSingleMonthCalendar(containerId, year, month) {
  const grid = document.getElementById(containerId);
  if (!grid) return;
  grid.innerHTML = '';

  const firstDayOfWeek = new Date(year, month, 1).getDay(); // 0 = Sun
  const totalDaysInMonth = new Date(year, month + 1, 0).getDate();
  const prevMonthTotalDays = new Date(year, month, 0).getDate();

  // Previous month trailing days
  for (let i = firstDayOfWeek - 1; i >= 0; i--) {
    const prevDay = prevMonthTotalDays - i;
    const prevMonthIdx = month === 0 ? 11 : month - 1;
    const prevYear = month === 0 ? year - 1 : year;
    const dateStr = formatDateStr(prevYear, prevMonthIdx, prevDay);
    const dayEl = createDayElement(prevDay, dateStr, true);
    grid.appendChild(dayEl);
  }

  // Current month days
  for (let d = 1; d <= totalDaysInMonth; d++) {
    const dateStr = formatDateStr(year, month, d);
    const dayEl = createDayElement(d, dateStr, false);
    grid.appendChild(dayEl);
  }

  // Next month leading days (to fill 42 cells)
  const currentTotal = firstDayOfWeek + totalDaysInMonth;
  const remaining = 42 - currentTotal;
  for (let d = 1; d <= remaining; d++) {
    const nextMonthIdx = month === 11 ? 0 : month + 1;
    const nextYear = month === 11 ? year + 1 : year;
    const dateStr = formatDateStr(nextYear, nextMonthIdx, d);
    const dayEl = createDayElement(d, dateStr, true);
    grid.appendChild(dayEl);
  }
}

function getMaxAllowedDateStr() {
  const today = new Date();
  const todayStr = formatDateObj(today);
  const latestDbDate = (availableReportDates && availableReportDates[0]) || todayStr;
  return todayStr > latestDbDate ? todayStr : latestDbDate;
}

function createDayElement(dayNum, dateStr, isOtherMonth) {
  const div = document.createElement('div');
  div.className = 'cal-day' + (isOtherMonth ? ' other-month' : '');
  div.innerText = dayNum;
  div.setAttribute('data-date', dateStr);

  const maxAllowedDate = getMaxAllowedDateStr();
  const isFuture = dateStr > maxAllowedDate;

  if (isFuture) {
    div.classList.add('disabled');
    div.title = `Ngày chưa xảy ra: ${dateStr}`;
  }

  if (availableReportDates.includes(dateStr)) {
    div.classList.add('has-data');
    div.title = `Có báo cáo dữ liệu: ${dateStr}`;
  }

  // Highlight selection range
  if (tempStartDate && tempEndDate) {
    if (tempStartDate === tempEndDate && dateStr === tempStartDate) {
      div.classList.add('selected-single');
    } else if (dateStr === tempStartDate) {
      div.classList.add('selected-start');
    } else if (dateStr === tempEndDate) {
      div.classList.add('selected-end');
    } else if (dateStr > tempStartDate && dateStr < tempEndDate) {
      div.classList.add('in-range');
    }
  } else if (tempStartDate && dateStr === tempStartDate) {
    div.classList.add('selected-single');
  }

  if (!isFuture) {
    div.addEventListener('click', () => {
      handleCalendarDateClick(dateStr);
    });
  }

  return div;
}

function handleCalendarDateClick(dateStr) {
  const maxAllowedDate = getMaxAllowedDateStr();
  if (dateStr > maxAllowedDate) {
    showToast('Không thể chọn ngày trong tương lai!');
    return;
  }

  document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));

  if (!tempStartDate || (tempStartDate && tempEndDate)) {
    tempStartDate = dateStr;
    tempEndDate = null;
  } else {
    if (dateStr < tempStartDate) {
      tempEndDate = tempStartDate;
      tempStartDate = dateStr;
    } else {
      tempEndDate = dateStr;
    }
  }

  updateRangeInputsDisplay();
  renderDualCalendar();
}

function selectPresetRange(rangeType) {
  const maxAllowedDate = getMaxAllowedDateStr();
  const ref = new Date(maxAllowedDate);

  let start = new Date(ref);
  let end = new Date(ref);

  switch (rangeType) {
    case 'today':
      start = new Date(ref);
      end = new Date(ref);
      break;
    case 'yesterday':
      start.setDate(start.getDate() - 1);
      end.setDate(end.getDate() - 1);
      break;
    case 'last7':
      start.setDate(start.getDate() - 6);
      break;
    case 'last28':
      start.setDate(start.getDate() - 27);
      break;
    case 'currentWeek': {
      const day = ref.getDay();
      const diff = ref.getDate() - day + (day === 0 ? -6 : 1);
      start = new Date(ref.setDate(diff));
      end = new Date(start);
      end.setDate(end.getDate() + 6);
      break;
    }
    case 'lastWeek': {
      const day = ref.getDay();
      const diff = ref.getDate() - day + (day === 0 ? -6 : 1) - 7;
      start = new Date(ref.setDate(diff));
      end = new Date(start);
      end.setDate(end.getDate() + 6);
      break;
    }
    case 'currentMonth':
      start = new Date(ref.getFullYear(), ref.getMonth(), 1);
      end = new Date(ref.getFullYear(), ref.getMonth() + 1, 0);
      break;
    case 'lastMonth':
      start = new Date(ref.getFullYear(), ref.getMonth() - 1, 1);
      end = new Date(ref.getFullYear(), ref.getMonth(), 0);
      break;
    case 'last3Months':
      start = new Date(ref.getFullYear(), ref.getMonth() - 2, 1);
      end = new Date(ref);
      break;
    case 'currentQuarter': {
      const qMonth = Math.floor(ref.getMonth() / 3) * 3;
      start = new Date(ref.getFullYear(), qMonth, 1);
      end = new Date(ref.getFullYear(), qMonth + 3, 0);
      break;
    }
    case 'lastQuarter': {
      const qMonth = Math.floor(ref.getMonth() / 3) * 3 - 3;
      start = new Date(ref.getFullYear(), qMonth, 1);
      end = new Date(ref.getFullYear(), qMonth + 3, 0);
      break;
    }
    case 'currentYear':
      start = new Date(ref.getFullYear(), 0, 1);
      end = new Date(ref.getFullYear(), 11, 31);
      break;
    case 'lastYear':
      start = new Date(ref.getFullYear() - 1, 0, 1);
      end = new Date(ref.getFullYear() - 1, 11, 31);
      break;
    case 'monthPicker':
      start = new Date(ref.getFullYear(), ref.getMonth(), 1);
      end = new Date(ref.getFullYear(), ref.getMonth() + 1, 0);
      break;
  }

  const maxAllowedDateObj = new Date(maxAllowedDate);
  if (end > maxAllowedDateObj) {
    end = new Date(maxAllowedDateObj);
  }
  if (start > maxAllowedDateObj) {
    start = new Date(maxAllowedDateObj);
  }

  tempStartDate = formatDateObj(start);
  tempEndDate = formatDateObj(end);

  calViewYear = start.getFullYear();
  calViewMonth = start.getMonth();

  updateRangeInputsDisplay();
  renderDualCalendar();
}

function formatDateObj(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function updateSelectedDateDisplay() {
  const displayEl = document.getElementById('displaySelectedDateRange');
  if (displayEl) {
    if (currentStartDate === currentEndDate) {
      displayEl.innerText = currentStartDate;
    } else {
      displayEl.innerText = `${currentStartDate} ➔ ${currentEndDate}`;
    }
  }
}

function applySelectedDateRange() {
  if (!tempEndDate) {
    tempEndDate = tempStartDate;
  }

  currentStartDate = tempStartDate;
  currentEndDate = tempEndDate;
  currentSelectedReportDate = tempEndDate;

  updateSelectedDateDisplay();

  const modal = document.getElementById('dateRangePickerModal');
  if (modal) modal.classList.remove('active');

  const displayEl = document.getElementById('displaySelectedDateRange');
  showToast(`Đang hiển thị báo cáo: ${displayEl ? displayEl.innerText : currentEndDate}`);
  loadAllData();
}

// ----------------------------------------------------
// 3. LOAD DATA (Overview & KPIs)
// ----------------------------------------------------
async function loadAllData() {
  await Promise.allSettled([
    loadOverviewData(currentDaysFilter),
    loadPagesTable(),
    loadTopContentData(),
    loadTopicsData(),
    loadStaffData(),
    loadMasterPagesTable(),
    loadHistoryTable(),
    loadSettings(),
    loadWebhookLogs()
  ]);
}

async function loadOverviewData(days = 14) {
  try {
    let url = `/api/overview?days=${days}&start_date=${encodeURIComponent(currentStartDate)}&end_date=${encodeURIComponent(currentEndDate)}`;
    if (currentUser.role !== 'admin') {
      url += `&staff_name=${encodeURIComponent(currentUser.name)}`;
    }
    const res = await fetch(url);
    const json = await res.json();
    if (!json.success) return;

    const data = json.data;
    currentOverviewData = data;

    if (data.availableDates && data.availableDates.length > 0) {
      availableReportDates = data.availableDates;
    }

    // Update Header Date Range Display Text
    const displayEl = document.getElementById('displaySelectedDateRange');
    if (displayEl) {
      if (currentStartDate === currentEndDate) {
        displayEl.innerText = currentStartDate;
      } else {
        displayEl.innerText = `${currentStartDate} ➔ ${currentEndDate}`;
      }
    }
    document.getElementById('navPageCount').innerText = data.totalPages;

    // Update KPIs
    document.getElementById('kpiTotalViews').innerText = formatNumber(data.summary.totalViews);
    document.getElementById('kpiAvgPostsDay').innerText = data.summary.avgPostsPerDay.toFixed(1);
    document.getElementById('kpiTotalPosts').innerText = `${data.summary.totalPosts} bài đăng hôm nay`;
    document.getElementById('kpiAvgER').innerText = `${data.summary.avgEngagementRate}%`;
    document.getElementById('kpiTotalInter').innerText = `${formatNumber(data.summary.totalInteractions)} tương tác`;

    if (data.summary.topPage) {
      document.getElementById('kpiTopPageName').innerText = data.summary.topPage.page_name;
      document.getElementById('kpiTopPageViews').innerText = `${formatNumber(data.summary.topPage.views)} lượt xem`;
    } else {
      document.getElementById('kpiTopPageName').innerText = 'Chưa có';
      document.getElementById('kpiTopPageViews').innerText = '0 views';
    }

    // Render Charts
    renderCharts(data);
  } catch (err) {
    console.error('Failed to load overview:', err);
  }
}

// ----------------------------------------------------
// 4. CHARTS RENDERING (Chart.js)
// ----------------------------------------------------
function renderCharts(data) {
  const isDark = document.body.classList.contains('dark-theme');
  const textColor = isDark ? '#9ca3af' : '#64748b';
  const gridColor = isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.06)';

  // Chart 1: Views Trend (Line Chart)
  const ctxTrend = document.getElementById('viewsTrendChart').getContext('2d');
  if (charts.viewsTrend) charts.viewsTrend.destroy();

  const dates = data.aggregatedTrend.map(d => formatDate(d.report_date));
  const viewsTrend = data.aggregatedTrend.map(d => d.total_views);
  const postsTrend = data.aggregatedTrend.map(d => d.avg_posts_per_day);

  charts.viewsTrend = new Chart(ctxTrend, {
    type: 'line',
    data: {
      labels: dates,
      datasets: [
        {
          label: 'Tổng Views',
          data: viewsTrend,
          borderColor: '#6366f1',
          backgroundColor: 'rgba(99, 102, 241, 0.15)',
          fill: true,
          tension: 0.35,
          borderWidth: 3,
          pointBackgroundColor: '#818cf8',
          pointRadius: 4,
          yAxisID: 'y'
        },
        {
          label: 'TB Posts / Ngày',
          data: postsTrend,
          borderColor: '#ec4899',
          borderDash: [5, 5],
          tension: 0.35,
          borderWidth: 2,
          pointBackgroundColor: '#ec4899',
          pointRadius: 3,
          yAxisID: 'y1'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { labels: { color: textColor, font: { family: 'Plus Jakarta Sans', weight: '600' } } }
      },
      scales: {
        x: { grid: { color: gridColor }, ticks: { color: textColor } },
        y: {
          grid: { color: gridColor },
          ticks: { color: textColor, callback: (v) => formatNumber(v) },
          title: { display: true, text: 'Views', color: textColor }
        },
        y1: {
          position: 'right',
          grid: { display: false },
          ticks: { color: textColor },
          title: { display: true, text: 'Posts/day', color: textColor }
        }
      }
    }
  });

  // Chart 2: Engagement Pie / Doughnut
  const ctxPie = document.getElementById('engagementPieChart').getContext('2d');
  if (charts.pie) charts.pie.destroy();

  const pagesComp = data.pageComparison || [];
  const pieLabels = pagesComp.map(p => p.page_name);
  const pieData = pagesComp.map(p => p.interactions || 1);
  const palette = ['#6366f1', '#ec4899', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#06b6d4'];

  charts.pie = new Chart(ctxPie, {
    type: 'doughnut',
    data: {
      labels: pieLabels,
      datasets: [{
        data: pieData,
        backgroundColor: palette.slice(0, pieLabels.length),
        borderWidth: 0,
        hoverOffset: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { color: textColor, font: { size: 11, family: 'Plus Jakarta Sans' } } }
      },
      cutout: '70%'
    }
  });

  // Chart 3: Page Views Comparison (Bar Chart)
  const ctxBarViews = document.getElementById('pageViewsBarChart').getContext('2d');
  if (charts.barViews) charts.barViews.destroy();

  charts.barViews = new Chart(ctxBarViews, {
    type: 'bar',
    data: {
      labels: pagesComp.map(p => p.page_name),
      datasets: [{
        label: 'Views Báo Cáo',
        data: pagesComp.map(p => p.views),
        backgroundColor: pagesComp.map(p => p.category === 'Đối thủ' ? '#f43f5e' : '#6366f1'),
        borderRadius: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: textColor, font: { size: 11 } } },
        y: { grid: { color: gridColor }, ticks: { color: textColor, callback: (v) => formatNumber(v) } }
      }
    }
  });

  // Chart 4: Posts / Day Comparison
  const ctxBarPosts = document.getElementById('postsPerDayBarChart').getContext('2d');
  if (charts.barPosts) charts.barPosts.destroy();

  charts.barPosts = new Chart(ctxBarPosts, {
    type: 'bar',
    data: {
      labels: pagesComp.map(p => p.page_name),
      datasets: [{
        label: 'Số lượng bài viết (Number of posts)',
        data: pagesComp.map(p => p.post_count !== undefined && p.post_count !== null ? p.post_count : p.posts_per_day),
        backgroundColor: '#8b5cf6',
        borderRadius: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false }, ticks: { color: textColor, font: { size: 11 } } },
        y: { grid: { color: gridColor }, ticks: { color: textColor } }
      }
    }
  });
}

// ----------------------------------------------------
// 5. PAGES TABLE & RANKING LOGIC
// ----------------------------------------------------
let allPagesData = [];
let currentPagesSort = { field: 'latest_views', order: 'desc' };

function initPagesSorting() {
  // Quick rank pills
  document.querySelectorAll('.rank-pill').forEach(pill => {
    pill.addEventListener('click', (e) => {
      document.querySelectorAll('.rank-pill').forEach(p => p.classList.remove('active'));
      const btn = e.currentTarget;
      btn.classList.add('active');
      
      const sortField = btn.getAttribute('data-sort');
      currentPagesSort = { field: sortField, order: 'desc' };
      renderSortedPagesTable();
      updateSortHeaderIcons();
    });
  });

  // Table header clicks
  document.querySelectorAll('#pagesTable .sortable-th').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.getAttribute('data-col');
      if (col === 'rank') return;

      if (currentPagesSort.field === col) {
        currentPagesSort.order = currentPagesSort.order === 'desc' ? 'asc' : 'desc';
      } else {
        currentPagesSort.field = col;
        currentPagesSort.order = 'desc';
      }

      // Update active pill if matches
      document.querySelectorAll('.rank-pill').forEach(p => {
        if (p.getAttribute('data-sort') === col && currentPagesSort.order === 'desc') {
          p.classList.add('active');
        } else {
          p.classList.remove('active');
        }
      });

      renderSortedPagesTable();
      updateSortHeaderIcons();
    });
  });
}

function updateSortHeaderIcons() {
  document.querySelectorAll('#pagesTable .sortable-th').forEach(th => {
    const col = th.getAttribute('data-col');
    th.classList.remove('sorted', 'asc', 'desc');
    const icon = th.querySelector('.sort-icon');
    if (!icon) return;

    if (col === currentPagesSort.field) {
      th.classList.add('sorted', currentPagesSort.order);
      icon.className = `fa-solid fa-sort-${currentPagesSort.order === 'desc' ? 'down' : 'up'} sort-icon`;
    } else {
      icon.className = 'fa-solid fa-sort sort-icon';
    }
  });
}

async function loadPagesTable() {
  try {
    let params = [];
    params.push(`start_date=${encodeURIComponent(currentStartDate)}`);
    params.push(`end_date=${encodeURIComponent(currentEndDate)}`);
    if (currentUser.role !== 'admin') {
      params.push(`staff_name=${encodeURIComponent(currentUser.name)}`);
    }
    let url = '/api/pages?' + params.join('&');
    const res = await fetch(url);
    const json = await res.json();
    if (!json.success) return;

    allPagesData = json.data;
    
    // Populate filter dropdown in History Tab
    const filterSelect = document.getElementById('filterHistoryPage');
    if (filterSelect) {
      filterSelect.innerHTML = '<option value="all">Tất cả Fanpage</option>';
      allPagesData.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.name;
        opt.innerText = p.name;
        filterSelect.appendChild(opt);
      });
    }

    renderSortedPagesTable();
  } catch (err) {
    console.error('Failed to load pages:', err);
  }
}

function renderSortedPagesTable() {
  const tbody = document.getElementById('pagesTableBody');
  if (!tbody) return;

  const searchTerm = (document.getElementById('searchPagesInput')?.value || '').toLowerCase().trim();

  // Sort array
  let sortedList = [...allPagesData].sort((a, b) => {
    let valA = a[currentPagesSort.field] ?? 0;
    let valB = b[currentPagesSort.field] ?? 0;

    if (typeof valA === 'string') {
      return currentPagesSort.order === 'desc'
        ? valB.localeCompare(valA)
        : valA.localeCompare(valB);
    }

    return currentPagesSort.order === 'desc'
      ? Number(valB) - Number(valA)
      : Number(valA) - Number(valB);
  });

  // Filter if staff filter is selected (Admin) or currentUser (Staff)
  const isAdminUser = currentUser && currentUser.role === 'admin';
  if (!isAdminUser && currentUser && currentUser.name) {
    sortedList = sortedList.filter(p => (p.staff_name || '') === currentUser.name);
  } else {
    const staffFilter = document.getElementById('filterPagesByStaff')?.value || 'all';
    if (staffFilter !== 'all') {
      sortedList = sortedList.filter(p => (p.staff_name || 'Chưa phân bổ') === staffFilter);
    }
  }

  // Filter if search
  if (searchTerm) {
    sortedList = sortedList.filter(p => 
      p.name.toLowerCase().includes(searchTerm) || 
      (p.page_id && String(p.page_id).includes(searchTerm)) ||
      (p.staff_name && p.staff_name.toLowerCase().includes(searchTerm))
    );
  }

  tbody.innerHTML = '';

  if (sortedList.length === 0) {
    tbody.innerHTML = '<tr><td colspan="10" style="text-align:center; padding:30px; color:var(--text-muted);">Không tìm thấy Fanpage nào phù hợp.</td></tr>';
    return;
  }

  sortedList.forEach((p, index) => {
    const rank = index + 1;
    let rankBadgeClass = 'rank-normal';
    if (rank === 1) rankBadgeClass = 'rank-1';
    else if (rank === 2) rankBadgeClass = 'rank-2';
    else if (rank === 3) rankBadgeClass = 'rank-3';

    let catClass = 'mybrand';
    if (p.category === 'Đối thủ') catClass = 'competitor';
    if (p.category === 'Tham khảo') catClass = 'reference';

    let fbUrl = '#';
    if (p.page_id && p.page_id.trim() !== '') {
      fbUrl = `https://facebook.com/${p.page_id.trim()}`;
    } else if (p.page_url && p.page_url.trim() !== '') {
      fbUrl = p.page_url;
    } else {
      fbUrl = `https://facebook.com/search/top?q=${encodeURIComponent(p.name)}`;
    }

    const avatarHtml = p.avatar_url && p.avatar_url.trim() !== ''
      ? `<img src="${escapeHtml(p.avatar_url)}" alt="Avatar" style="width:34px; height:34px; border-radius:50%; object-fit:cover; border:1px solid var(--border-color);" onerror="this.style.display='none'">`
      : `<div style="width:34px; height:34px; border-radius:50%; background:rgba(24,119,242,0.15); color:#1877f2; display:flex; align-items:center; justify-content:center; font-size:14px;"><i class="fa-brands fa-facebook-f"></i></div>`;

    const staffName = p.staff_name && p.staff_name.trim() !== '' && p.staff_name !== 'Chưa phân bổ'
      ? `<span class="staff-badge assigned" title="Nhân sự phụ trách"><i class="fa-solid fa-user-check"></i> ${escapeHtml(p.staff_name)}</span>`
      : `<span class="staff-badge unassigned" title="Bấm để phân bổ nhân sự" onclick="promptAssignStaff('${escapeHtml(p.name)}')"><i class="fa-solid fa-plus"></i> Gán NV</span>`;

    const topicBadge = p.topic && p.topic.trim() !== '' && p.topic !== 'Chưa phân loại'
      ? `<span onclick="promptAssignTopic('${escapeHtml(p.name)}', '${escapeHtml(p.topic)}')" style="cursor:pointer;" title="Bấm để đổi chủ đề">${getTopicBadge(p.topic)}</span>`
      : `<span class="topic-badge unclassified" onclick="promptAssignTopic('${escapeHtml(p.name)}', '')" style="cursor:pointer;" title="Bấm để gán chủ đề"><i class="fa-solid fa-plus"></i> Gán chủ đề</span>`;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <span class="rank-badge ${rankBadgeClass}">
          ${rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : rank}
        </span>
      </td>
      <td class="page-name-cell">
        <div style="display:flex; align-items:center; gap:10px;">
          ${avatarHtml}
          <div>
            <a href="${escapeHtml(fbUrl)}" target="_blank" rel="noopener noreferrer" class="page-title-link" title="Mở Facebook: ${escapeHtml(fbUrl)}">
              <strong>${escapeHtml(p.name)}</strong>
              <i class="fa-solid fa-arrow-up-right-from-square open-link-icon"></i>
            </a>
            ${p.page_id ? `<br><span style="font-size:11px; color:var(--text-dim); font-family:monospace;">ID: ${escapeHtml(p.page_id)}</span>` : ''}
          </div>
        </div>
      </td>
      <td>${topicBadge}</td>
      <td><span class="category-tag ${catClass}">${escapeHtml(p.category || 'Của tôi')}</span></td>
      <td>${staffName}</td>
      <td><b style="color:var(--accent-blue); font-size:14px;">${formatNumber(p.latest_views || 0)}</b></td>
      <td><span style="color:var(--accent-purple); font-weight:700;">${p.latest_post_count !== undefined && p.latest_post_count !== null ? formatNumber(p.latest_post_count) : formatNumber(p.latest_posts_per_day || 0)}</span> bài</td>
      <td><span style="color:var(--accent-emerald); font-weight:700;">${p.latest_engagement_rate ? p.latest_engagement_rate.toFixed(2) : '0.00'}%</span></td>
      <td><b>${formatNumber(p.latest_followers || 0)}</b></td>
      <td>${p.latest_report_date || 'Chưa có'}</td>
      <td>
        <div class="action-btn-group">
          <a href="${escapeHtml(fbUrl)}" target="_blank" rel="noopener noreferrer" class="btn-fb-action" title="Nhảy tới ${escapeHtml(fbUrl)}">
            <i class="fa-brands fa-facebook-f"></i> Xem Page
          </a>
          <button class="icon-btn danger" onclick="deletePage(${p.id}, '${escapeHtml(p.name)}')" title="Xóa trang">
            <i class="fa-regular fa-trash-can"></i>
          </button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// Helper: Topic Badges
function getTopicBadge(topicName) {
  if (!topicName || topicName === 'Chưa phân loại') {
    return `<span class="topic-badge unclassified"><i class="fa-solid fa-shapes"></i> Chưa phân loại</span>`;
  }
  const clean = topicName.toLowerCase();
  let cls = 'default';
  let icon = 'fa-shapes';

  if (clean.includes('gia dụng') || clean.includes('giadung')) {
    cls = 'giadung';
    icon = 'fa-couch';
  } else if (clean.includes('decor') || clean.includes('trang trí')) {
    cls = 'decor';
    icon = 'fa-wand-magic-sparkles';
  } else if (clean.includes('top trend') || clean.includes('trend')) {
    cls = 'toptrend';
    icon = 'fa-fire';
  } else if (clean.includes('fitness') || clean.includes('sức khỏe')) {
    cls = 'fitness';
    icon = 'fa-dumbbell';
  }

  return `<span class="topic-badge ${cls}"><i class="fa-solid ${icon}"></i> ${escapeHtml(topicName)}</span>`;
}

// Prompt to assign topic inline
async function promptAssignTopic(pageName, currentTopic) {
  const topic = prompt(`Nhập chủ đề nội dung cho trang "${pageName}" (Ví dụ: KOC review gia dụng, KOC review decor, Top trend review...):`, currentTopic || '');
  if (topic === null) return;

  try {
    const res = await fetch('/api/pages/topic', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ page_name: pageName, topic: topic.trim() })
    });
    const data = await res.json();
    if (data.success) {
      showToast(data.message);
      loadAllData();
    } else {
      alert(data.error);
    }
  } catch (err) {
    alert('Lỗi: ' + err.message);
  }
}

// Prompt to assign staff inline
async function promptAssignStaff(pageName) {
  const staffName = prompt(`Nhập tên nhân sự phụ trách cho trang "${pageName}":`);
  if (!staffName || !staffName.trim()) return;

  try {
    const res = await fetch('/api/pages/assign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ page_name: pageName, staff_name: staffName.trim() })
    });
    const data = await res.json();
    if (data.success) {
      showToast(data.message);
      loadAllData();
    } else {
      alert(data.error);
    }
  } catch (err) {
    alert('Lỗi: ' + err.message);
  }
}

// ----------------------------------------------------
// 5.05 TOP CONTENT & POSTS OVERVIEW
// ----------------------------------------------------
let allPostsData = [];
let currentPostsSort = { field: 'interactions', order: 'desc' };

function initTopContentEventListeners() {
  // Rank pills
  document.querySelectorAll('.rank-pill[data-post-sort]').forEach(pill => {
    pill.addEventListener('click', (e) => {
      document.querySelectorAll('.rank-pill[data-post-sort]').forEach(p => p.classList.remove('active'));
      const btn = e.currentTarget;
      btn.classList.add('active');

      const sortField = btn.getAttribute('data-post-sort');
      currentPostsSort = { field: sortField, order: 'desc' };
      loadTopContentData();
      updatePostSortHeaderIcons();
    });
  });

  // Table header sorting
  document.querySelectorAll('#postsTable .sortable-th[data-post-col]').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.getAttribute('data-post-col');
      if (currentPostsSort.field === col) {
        currentPostsSort.order = currentPostsSort.order === 'desc' ? 'asc' : 'desc';
      } else {
        currentPostsSort.field = col;
        currentPostsSort.order = 'desc';
      }

      // Update active rank pill if matching
      document.querySelectorAll('.rank-pill[data-post-sort]').forEach(p => {
        if (p.getAttribute('data-post-sort') === col && currentPostsSort.order === 'desc') {
          p.classList.add('active');
        } else {
          p.classList.remove('active');
        }
      });

      loadTopContentData();
      updatePostSortHeaderIcons();
    });
  });

  // Filter dropdowns
  document.getElementById('filterPostsByPage')?.addEventListener('change', () => {
    loadTopContentData();
  });
  document.getElementById('filterPostsByStaff')?.addEventListener('change', () => {
    loadTopContentData();
  });

  // Search input
  let searchTimeout = null;
  document.getElementById('searchPostsInput')?.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      loadTopContentData();
    }, 250);
  });

  // Export CSV
  document.getElementById('btnExportPostsCSV')?.addEventListener('click', exportPostsToCSV);

  // Import Posts File from Fanpage Karma
  const postsFileInput = document.getElementById('postsFileInput');
  document.getElementById('btnImportPostsFile')?.addEventListener('click', () => {
    postsFileInput?.click();
  });
  postsFileInput?.addEventListener('change', handlePostsFileUpload);

  // Add Post Modal
  const postModal = document.getElementById('postModal');
  document.getElementById('btnOpenAddPostModal')?.addEventListener('click', () => {
    postModal.classList.add('active');
    document.getElementById('inputPostPageName')?.focus();
  });
  document.getElementById('btnClosePostModal')?.addEventListener('click', () => postModal.classList.remove('active'));
  document.getElementById('btnCancelPostModal')?.addEventListener('click', () => postModal.classList.remove('active'));

  // Post Detail Modal close
  document.getElementById('btnClosePostDetailModal')?.addEventListener('click', () => {
    document.getElementById('postDetailModal')?.classList.remove('active');
  });

  // Add Post Form submit
  document.getElementById('addPostForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const page_name = document.getElementById('inputPostPageName').value.trim();
    const message = document.getElementById('inputPostMessage').value.trim();
    const post_url = document.getElementById('inputPostUrl').value.trim();
    const thumbnail_url = document.getElementById('inputPostThumbnail').value.trim();
    const likes = parseInt(document.getElementById('inputPostLikes').value || 0, 10);
    const comments = parseInt(document.getElementById('inputPostComments').value || 0, 10);
    const shares = parseInt(document.getElementById('inputPostShares').value || 0, 10);
    const reach = parseInt(document.getElementById('inputPostReach').value || 0, 10);
    const interactions_per_impression = parseFloat(document.getElementById('inputPostIpi').value || 0);

    try {
      const res = await fetch('/api/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          page_name,
          message,
          post_url,
          thumbnail_url,
          likes,
          comments,
          shares,
          reach,
          interactions_per_impression
        })
      });
      const data = await res.json();
      if (data.success) {
        showToast('Đã thêm bài viết vào Top Content thành công!');
        postModal.classList.remove('active');
        document.getElementById('addPostForm').reset();
        loadTopContentData();
      } else {
        alert(data.error);
      }
    } catch (err) {
      alert('Lỗi kết nối: ' + err.message);
    }
  });
}

function updatePostSortHeaderIcons() {
  document.querySelectorAll('#postsTable .sortable-th[data-post-col]').forEach(th => {
    const col = th.getAttribute('data-post-col');
    th.classList.remove('sorted', 'asc', 'desc');
    const icon = th.querySelector('.sort-icon');
    if (!icon) return;

    if (col === currentPostsSort.field) {
      th.classList.add('sorted', currentPostsSort.order);
      icon.className = `fa-solid fa-sort-${currentPostsSort.order === 'desc' ? 'down' : 'up'} sort-icon`;
    } else {
      icon.className = 'fa-solid fa-sort sort-icon';
    }
  });
}

async function loadTopContentData() {
  try {
    const pageFilter = document.getElementById('filterPostsByPage')?.value || 'all';
    const staffFilter = document.getElementById('filterPostsByStaff')?.value || 'all';
    const searchQuery = document.getElementById('searchPostsInput')?.value || '';

    let url = `/api/posts?sort_by=${encodeURIComponent(currentPostsSort.field)}&order=${encodeURIComponent(currentPostsSort.order)}`;
    
    if (pageFilter && pageFilter !== 'all') {
      url += `&page_name=${encodeURIComponent(pageFilter)}`;
    }

    if (staffFilter && staffFilter !== 'all') {
      url += `&staff_name=${encodeURIComponent(staffFilter)}`;
    } else if (currentUser && currentUser.role !== 'admin') {
      url += `&staff_name=${encodeURIComponent(currentUser.name)}`;
    }

    if (searchQuery.trim()) {
      url += `&q=${encodeURIComponent(searchQuery.trim())}`;
    }

    const res = await fetch(url);
    const json = await res.json();
    if (!json.success) return;

    allPostsData = json.data || [];
    const summary = json.summary || {};

    // Update Top Content KPIs
    const topPostPageEl = document.getElementById('kpiTopPostPage');
    const topPostInterEl = document.getElementById('kpiTopPostInter');
    const totalInterEl = document.getElementById('kpiTotalPostInteractions');
    const likesCommentsEl = document.getElementById('kpiPostLikesComments');
    const avgEREl = document.getElementById('kpiAvgPostER');
    const avgReachEl = document.getElementById('kpiAvgPostReach');
    const totalTrackedEl = document.getElementById('kpiTotalTrackedPosts');
    const navCountEl = document.getElementById('navTopContentCount');

    if (navCountEl) navCountEl.innerText = summary.totalPosts || 0;
    if (totalTrackedEl) totalTrackedEl.innerText = `${summary.totalPosts || 0} bài viết theo dõi`;
    if (totalInterEl) totalInterEl.innerText = formatNumber(summary.totalInteractions || 0);
    if (likesCommentsEl) {
      likesCommentsEl.innerText = `${formatNumber(summary.totalLikes || 0)} likes · ${formatNumber(summary.totalComments || 0)} comments`;
    }
    if (avgEREl) avgEREl.innerText = `${(summary.avgInteractionRate || 0).toFixed(4)}%`;
    if (avgReachEl) avgReachEl.innerText = formatNumber(summary.avgReach || 0);

    if (summary.topPost) {
      if (topPostPageEl) topPostPageEl.innerText = summary.topPost.page_name;
      if (topPostInterEl) topPostInterEl.innerText = `${formatNumber(summary.topPost.interactions || 0)} tương tác (${(summary.topPost.interaction_rate || 0).toFixed(4)}%)`;
    } else {
      if (topPostPageEl) topPostPageEl.innerText = 'Chưa có';
      if (topPostInterEl) topPostInterEl.innerText = '0 tương tác';
    }

    // Populate filter dropdowns if not already populated or on initial load
    populateTopContentFilters(allPostsData);

    // Render Table
    renderPostsTable(allPostsData);
  } catch (err) {
    console.error('Failed to load top content posts:', err);
  }
}

function populateTopContentFilters(posts) {
  const pageSelect = document.getElementById('filterPostsByPage');
  const staffSelect = document.getElementById('filterPostsByStaff');
  const datalist = document.getElementById('pagesDatalist');

  if (pageSelect && pageSelect.options.length <= 1 && allPagesData.length > 0) {
    pageSelect.innerHTML = '<option value="all">Tất cả Fanpage</option>';
    allPagesData.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.name;
      opt.innerText = p.name;
      pageSelect.appendChild(opt);
    });
  }

  if (staffSelect && staffSelect.options.length <= 1 && availableUsers.length > 0) {
    staffSelect.innerHTML = '<option value="all">Tất cả nhân sự</option>';
    availableUsers.filter(u => u.name !== 'Admin').forEach(u => {
      const opt = document.createElement('option');
      opt.value = u.name;
      opt.innerText = u.name;
      staffSelect.appendChild(opt);
    });
  }

  if (datalist && allPagesData.length > 0) {
    datalist.innerHTML = '';
    allPagesData.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.name;
      datalist.appendChild(opt);
    });
  }
}

function renderPostsTable(posts) {
  const tbody = document.getElementById('postsTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (!posts || posts.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="11" style="text-align: center; padding: 48px; color: var(--text-muted);">
          <i class="fa-solid fa-fire-flame-curved" style="font-size: 36px; margin-bottom: 12px; opacity: 0.3; display: block;"></i>
          <strong>Chưa có dữ liệu bài viết Top Content</strong>
          <p style="font-size: 12px; margin-top: 4px;">Nạp file xuất "Top Posts" từ Fanpage Karma hoặc nhấn "Thêm Bài Viết" để bắt đầu theo dõi.</p>
        </td>
      </tr>
    `;
    return;
  }

  posts.forEach((post, index) => {
    const rank = index + 1;
    const rankBadgeClass = rank === 1 ? 'rank-1' : (rank === 2 ? 'rank-2' : (rank === 3 ? 'rank-3' : ''));

    // Format post publication date & time (e.g. 8/20/26, 1:57 AM)
    let formattedDate = '';
    if (post.published_at) {
      try {
        const d = new Date(post.published_at);
        if (!isNaN(d.getTime())) {
          formattedDate = d.toLocaleString('en-US', {
            month: 'numeric',
            day: 'numeric',
            year: '2-digit',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
          });
        } else {
          formattedDate = post.published_at;
        }
      } catch (e) {
        formattedDate = post.published_at;
      }
    }

    // Avatar
    const avatarHtml = post.page_avatar
      ? `<img src="${escapeHtml(post.page_avatar)}" class="post-page-avatar" alt="${escapeHtml(post.page_name)}">`
      : `<div class="post-page-avatar-placeholder">${escapeHtml(post.page_name.substring(0, 1).toUpperCase())}</div>`;

    // FB url
    const fbPageUrl = post.page_link || `https://facebook.com/${encodeURIComponent(post.page_name)}`;
    const postDirectUrl = post.post_url || fbPageUrl;

    // Media Thumbnail
    const thumbImg = post.thumbnail_url || 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=100&h=100&fit=crop';
    const isVideo = post.media_type === 'video';

    // Negative sentiment badge
    const negSentiment = parseFloat(post.negative_sentiment_share || 0);
    const sentimentHtml = negSentiment > 50
      ? `<span class="sentiment-badge negative-high">${negSentiment}%</span>`
      : `<span class="sentiment-badge zero">${negSentiment}%</span>`;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="text-align: center;">
        <span class="rank-badge ${rankBadgeClass}">
          ${rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : rank}
        </span>
      </td>
      <td>
        <div class="post-page-cell">
          ${avatarHtml}
          <div class="post-page-info">
            <div class="post-page-name-row">
              <i class="fa-brands fa-facebook fb-brand-icon"></i>
              <a href="${escapeHtml(fbPageUrl)}" target="_blank" rel="noopener noreferrer" class="post-page-name" title="Mở Fanpage: ${escapeHtml(post.page_name)}">
                ${escapeHtml(post.page_name)}
              </a>
            </div>
            <span class="post-pub-date">${escapeHtml(formattedDate)}</span>
          </div>
        </div>
      </td>
      <td>
        <div class="post-content-cell">
          <div class="post-media-wrap" onclick="showPostDetailModal(${post.id})" title="Nhấp để xem chi tiết bài viết">
            <img src="${escapeHtml(thumbImg)}" class="post-media-thumb" alt="media">
            ${isVideo ? '<div class="media-play-icon"><i class="fa-solid fa-play"></i></div>' : ''}
          </div>
          <div class="post-message-snippet" onclick="showPostDetailModal(${post.id})" title="${escapeHtml(post.message || 'Xem chi tiết')}">
            ${escapeHtml(post.message || '(Không có nội dung văn bản)')}
          </div>
        </div>
      </td>
      <td style="text-align: right;">
        <span class="metric-num">${formatNumber(post.likes || 0)}</span>
      </td>
      <td style="text-align: right;">
        <span class="metric-num">${formatNumber(post.comments || 0)}</span>
      </td>
      <td style="text-align: right;">
        <span class="metric-interactions-badge">${formatNumber(post.interactions || 0)}</span>
      </td>
      <td style="text-align: right;">
        <span class="metric-rate">${post.interaction_rate ? (post.interaction_rate).toFixed(post.interaction_rate < 0.01 ? 4 : 2) + '%' : '0%'}</span>
      </td>
      <td style="text-align: right;">
        <span class="metric-num">${post.reach ? formatNumber(post.reach) : (rank % 2 === 0 ? '☆' : '0')}</span>
      </td>
      <td style="text-align: right;">
        <span class="metric-num">${post.interactions_per_impression ? post.interactions_per_impression + '%' : (rank % 2 === 0 ? '☆' : '0%')}</span>
      </td>
      <td style="text-align: right;">
        ${sentimentHtml}
      </td>
      <td style="text-align: center;">
        <div class="action-btn-group" style="justify-content: center;">
          <button class="btn btn-secondary btn-sm" onclick="showPostDetailModal(${post.id})" title="Xem chi tiết">
            <i class="fa-solid fa-expand"></i>
          </button>
          <a href="${escapeHtml(postDirectUrl)}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-sm" title="Mở trên Facebook">
            <i class="fa-solid fa-arrow-up-right-from-square"></i>
          </a>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function showPostDetailModal(postId) {
  const post = allPostsData.find(p => p.id === postId);
  if (!post) return;

  const modal = document.getElementById('postDetailModal');
  const body = document.getElementById('postDetailBody');
  if (!modal || !body) return;

  const postDirectUrl = post.post_url || (post.page_link ? `${post.page_link}` : `https://facebook.com/${encodeURIComponent(post.page_name)}`);
  const thumbImg = post.thumbnail_url || 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=600&h=300&fit=crop';

  body.innerHTML = `
    <div class="post-detail-header-card">
      <div style="flex:1;">
        <div style="display:flex; align-items:center; gap:8px;">
          <i class="fa-brands fa-facebook" style="color:#1877f2; font-size:18px;"></i>
          <strong style="font-size:16px; color:var(--text-main);">${escapeHtml(post.page_name)}</strong>
        </div>
        <small style="color:var(--text-muted); display:block; margin-top:2px;">
          <i class="fa-regular fa-clock"></i> Đăng lúc: ${escapeHtml(post.published_at || 'Không xác định')} | Người phụ trách: <b>${escapeHtml(post.staff_name || 'Chưa phân bổ')}</b>
        </small>
      </div>
      <a href="${escapeHtml(postDirectUrl)}" target="_blank" rel="noopener noreferrer" class="btn btn-primary btn-sm">
        <i class="fa-solid fa-arrow-up-right-from-square"></i> Xem Bài Gốc
      </a>
    </div>

    ${post.thumbnail_url ? `<img src="${escapeHtml(thumbImg)}" class="post-detail-preview-img" alt="preview">` : ''}

    <div class="post-detail-message-box">
      <strong style="color:var(--text-muted); font-size:12px; display:block; margin-bottom:6px; text-transform:uppercase;">Nội dung bài viết:</strong>
      ${escapeHtml(post.message || '(Không có nội dung văn bản)')}
    </div>

    <div class="post-detail-kpi-row">
      <div class="post-kpi-box">
        <div class="val" style="color:var(--accent-blue);">${formatNumber(post.likes || 0)}</div>
        <div class="lbl"><i class="fa-regular fa-thumbs-up"></i> Likes</div>
      </div>
      <div class="post-kpi-box">
        <div class="val" style="color:var(--accent-purple);">${formatNumber(post.comments || 0)}</div>
        <div class="lbl"><i class="fa-regular fa-comment"></i> Comments</div>
      </div>
      <div class="post-kpi-box">
        <div class="val" style="color:#fb7185;">${formatNumber(post.interactions || 0)}</div>
        <div class="lbl"><i class="fa-solid fa-heart-pulse"></i> Tổng Tương Tác</div>
      </div>
      <div class="post-kpi-box">
        <div class="val" style="color:var(--accent-emerald);">${post.interaction_rate ? post.interaction_rate.toFixed(4) + '%' : '0%'}</div>
        <div class="lbl"><i class="fa-solid fa-chart-line"></i> Post ER (%)</div>
      </div>
      <div class="post-kpi-box">
        <div class="val">${formatNumber(post.reach || 0)}</div>
        <div class="lbl"><i class="fa-solid fa-eye"></i> Reach / Views</div>
      </div>
      <div class="post-kpi-box">
        <div class="val">${post.interactions_per_impression || 0}%</div>
        <div class="lbl"><i class="fa-solid fa-percent"></i> Inter / View</div>
      </div>
      <div class="post-kpi-box">
        <div class="val" style="color:${post.negative_sentiment_share > 0 ? '#f43f5e' : 'var(--text-main)'};">${post.negative_sentiment_share || 0}%</div>
        <div class="lbl"><i class="fa-regular fa-face-frown"></i> Tiêu cực</div>
      </div>
      <div class="post-kpi-box">
        <div class="val">${formatNumber(post.shares || 0)}</div>
        <div class="lbl"><i class="fa-solid fa-share-nodes"></i> Shares</div>
      </div>
    </div>
  `;

  modal.classList.add('active');
}

function exportPostsToCSV() {
  if (!allPostsData || allPostsData.length === 0) {
    alert('Không có dữ liệu bài viết để xuất file.');
    return;
  }

  const headers = ['Hạng', 'Fanpage', 'Ngày Đăng', 'Nội Dung', 'Likes', 'Comments', 'Shares', 'Tổng Tương Tác', 'Post ER (%)', 'Reach', 'Interactions/Impression (%)', 'Negative Sentiment (%)', 'Nhân Sự', 'URL Bài Viết'];
  const rows = allPostsData.map((p, idx) => [
    idx + 1,
    `"${(p.page_name || '').replace(/"/g, '""')}"`,
    `"${p.published_at || ''}"`,
    `"${(p.message || '').replace(/"/g, '""')}"`,
    p.likes || 0,
    p.comments || 0,
    p.shares || 0,
    p.interactions || 0,
    p.interaction_rate || 0,
    p.reach || 0,
    p.interactions_per_impression || 0,
    p.negative_sentiment_share || 0,
    `"${p.staff_name || ''}"`,
    `"${p.post_url || ''}"`
  ]);

  const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `top_content_posts_${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Đã xuất file CSV Top Content thành công!');
}

async function handlePostsFileUpload(e) {
  const file = e.target.files?.[0];
  if (!file) return;

  const btn = document.getElementById('btnImportPostsFile');
  const originalHtml = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang nạp...';
  }

  const formData = new FormData();
  formData.append('file', file);

  try {
    const res = await fetch('/api/upload', {
      method: 'POST',
      body: formData
    });
    const data = await res.json();

    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalHtml;
    }

    if (data.success) {
      showToast(data.message || `Đã nạp thành công ${data.count || 0} bài viết Top Content từ file Fanpage Karma!`);
      e.target.value = '';
      loadTopContentData();
    } else {
      alert(data.error || 'Nạp file thất bại.');
    }
  } catch (err) {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalHtml;
    }
    alert('Lỗi khi nạp file: ' + err.message);
  }
}

// ----------------------------------------------------
// 5.1 STAFF & MASTER LIST MANAGEMENT
// ----------------------------------------------------
let allStaffList = [];
let allMasterList = [];

async function loadStaffData() {
  try {
    let url = `/api/staff?start_date=${encodeURIComponent(currentStartDate)}&end_date=${encodeURIComponent(currentEndDate)}`;
    const res = await fetch(url);
    const json = await res.json();
    if (!json.success) return;

    allStaffList = json.data;
    const unassignedCount = json.unassignedCount || 0;
    const isAdmin = currentUser && currentUser.role === 'admin';

    // Toggle KPI Grid visibility (Admin only)
    const staffKpiGrid = document.getElementById('staffKpiGrid');
    if (staffKpiGrid) {
      staffKpiGrid.style.display = isAdmin ? 'grid' : 'none';
    }

    // Toggle Personal KPI Bar (Staff only)
    const staffPersonalKpiBar = document.getElementById('staffPersonalKpiBar');
    if (staffPersonalKpiBar) {
      staffPersonalKpiBar.style.display = !isAdmin ? 'grid' : 'none';
    }

    // Toggle Staff Leaderboard & Master Card Width
    const staffLeaderboardCard = document.getElementById('staffLeaderboardCard');
    if (staffLeaderboardCard) {
      staffLeaderboardCard.style.display = isAdmin ? 'block' : 'none';
    }
    const masterPagesCard = document.getElementById('masterPagesCard');
    if (masterPagesCard) {
      masterPagesCard.className = 'glass-card span-12';
    }

    // Update Personal Staff Stats for non-admin
    if (!isAdmin && currentUser && currentUser.name) {
      const myStaff = allStaffList.find(s => s.name === currentUser.name) || {};
      const myReported = myStaff.reported_pages_count || 0;
      const myNoData = myStaff.no_data_pages_count || 0;
      const myError = myStaff.error_pages_count || 0;
      const myTotal = myStaff.total_pages_assigned || (myReported + myNoData + myError);
      const myViews = myStaff.total_views_latest || 0;
      const myAvgPosts = myStaff.avg_posts_per_day || 0;

      const elRep = document.getElementById('kpiPersonalReported');
      const elNoData = document.getElementById('kpiPersonalNoData');
      const elError = document.getElementById('kpiPersonalError');
      const elTot = document.getElementById('kpiPersonalTotal');
      const elName = document.getElementById('kpiPersonalStaffName');
      const elViews = document.getElementById('kpiPersonalViews');
      const elAvg = document.getElementById('kpiPersonalAvgPosts');

      if (elRep) elRep.innerText = myReported;
      if (elNoData) elNoData.innerText = myNoData;
      if (elError) elError.innerText = myError;
      if (elTot) elTot.innerText = myTotal;
      if (elName) elName.innerText = currentUser.name;
      if (elViews) elViews.innerText = `${formatNumber(myViews)} views`;
      if (elAvg) elAvg.innerText = `TB: ${myAvgPosts.toFixed(1)} bài/ngày`;
    }

    // Update KPI badges
    document.getElementById('navStaffCount').innerText = allStaffList.length;
    document.getElementById('kpiStaffCount').innerText = allStaffList.length;
    document.getElementById('kpiUnassignedCount').innerText = unassignedCount;

    let totalAssigned = 0;
    allStaffList.forEach(s => totalAssigned += (s.total_pages_assigned || 0));
    document.getElementById('kpiAssignedPagesCount').innerText = totalAssigned;

    if (allStaffList.length > 0 && allStaffList[0].total_views_latest > 0) {
      document.getElementById('kpiTopStaffName').innerText = allStaffList[0].name;
      document.getElementById('kpiTopStaffViews').innerText = `${formatNumber(allStaffList[0].total_views_latest)} views`;
    } else {
      document.getElementById('kpiTopStaffName').innerText = 'Chưa có';
      document.getElementById('kpiTopStaffViews').innerText = '0 views';
    }

    // Populate datalist & filter dropdowns
    const staffDatalist = document.getElementById('staffDatalist');
    const staffFilterSelect = document.getElementById('filterPagesByStaff');
    if (staffDatalist) {
      staffDatalist.innerHTML = allStaffList.map(s => `<option value="${escapeHtml(s.name)}">${escapeHtml(s.name)} (${s.department || ''})</option>`).join('');
    }
    if (staffFilterSelect) {
      const currentVal = staffFilterSelect.value;
      staffFilterSelect.innerHTML = '<option value="all">Tất cả nhân sự</option>';
      allStaffList.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.name;
        opt.innerText = `${s.name} (${s.total_pages_assigned || 0} page)`;
        staffFilterSelect.appendChild(opt);
      });
      staffFilterSelect.value = currentVal || 'all';
    }

    // Render Staff Table
    const tbody = document.getElementById('staffTableBody');
    if (tbody) {
      tbody.innerHTML = '';
      if (allStaffList.length === 0) {
        tbody.innerHTML = '<tr><td colspan="10" style="text-align:center; padding:30px; color:var(--text-muted);">Chưa có nhân sự nào được tạo.</td></tr>';
      } else {
        allStaffList.forEach((s, idx) => {
          const rank = idx + 1;
          const totalAssigned = s.total_pages_assigned || s.master_pages_count || s.pages_table_count || 0;
          const reported = s.reported_pages_count || 0;
          const errorCount = s.error_pages_count || 0;
          const noData = Math.max(0, totalAssigned - reported);
          const percent = totalAssigned > 0 ? Math.min(100, Math.round((reported / totalAssigned) * 100)) : 0;
          const initials = (s.name || 'NV').split(' ').map(w => w[0]).filter(Boolean).slice(-2).join('').toUpperCase();

          const rankBadge = rank === 1 
            ? '<span class="rank-badge rank-1" style="font-size: 16px;">🥇</span>' 
            : rank === 2 
            ? '<span class="rank-badge rank-2" style="font-size: 16px;">🥈</span>' 
            : rank === 3 
            ? '<span class="rank-badge rank-3" style="font-size: 16px;">🥉</span>' 
            : `<span class="rank-badge rank-normal" style="font-weight: 700;">${rank}</span>`;

          const tr = document.createElement('tr');
          tr.innerHTML = `
            <td style="text-align: center;">${rankBadge}</td>
            <td>
              <div style="display: flex; align-items: center; gap: 10px;">
                <div style="width: 34px; height: 34px; border-radius: 50%; background: linear-gradient(135deg, rgba(99, 102, 241, 0.2), rgba(168, 85, 247, 0.2)); border: 1px solid rgba(168, 85, 247, 0.3); color: #c084fc; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 12px; flex-shrink: 0;">
                  ${initials}
                </div>
                <div>
                  <strong style="color: var(--text-color); font-size: 14px;">${escapeHtml(s.name)}</strong>
                  ${s.department ? `<br><small style="color: var(--text-dim); font-size: 11px;"><i class="fa-solid fa-building-user" style="font-size: 10px; margin-right: 3px;"></i>${escapeHtml(s.department)}</small>` : ''}
                </div>
              </div>
            </td>
            <td style="text-align: center;">
              <span class="badge" style="background: rgba(168, 85, 247, 0.12); color: #c084fc; font-weight: 700; font-size: 13px; padding: 4px 10px; border-radius: 8px; border: 1px solid rgba(168, 85, 247, 0.25);">
                <i class="fa-solid fa-layer-group" style="font-size: 11px; margin-right: 4px;"></i>${totalAssigned} page
              </span>
            </td>
            <td style="text-align: center;">
              <span class="badge" style="background: rgba(16, 185, 129, 0.12); color: #10b981; font-weight: 700; font-size: 13px; padding: 4px 10px; border-radius: 8px; border: 1px solid rgba(16, 185, 129, 0.25);" title="${percent}% hoàn thành">
                <i class="fa-solid fa-circle-check" style="font-size: 11px; margin-right: 4px;"></i>${reported} (${percent}%)
              </span>
            </td>
            <td style="text-align: center;">
              <span class="badge" style="background: ${noData > 0 ? 'rgba(245, 158, 11, 0.12)' : 'rgba(255, 255, 255, 0.04)'}; color: ${noData > 0 ? '#f59e0b' : 'var(--text-dim)'}; font-weight: 700; font-size: 13px; padding: 4px 10px; border-radius: 8px; border: 1px solid ${noData > 0 ? 'rgba(245, 158, 11, 0.25)' : 'transparent'};">
                <i class="fa-solid ${noData > 0 ? 'fa-clock' : 'fa-check'}" style="font-size: 11px; margin-right: 4px;"></i>${noData}
              </span>
            </td>
            <td style="text-align: center;">
              <span class="badge" style="background: ${errorCount > 0 ? 'rgba(239, 68, 68, 0.15)' : 'rgba(255, 255, 255, 0.04)'}; color: ${errorCount > 0 ? '#f43f5e' : 'var(--text-dim)'}; font-weight: 700; font-size: 13px; padding: 4px 10px; border-radius: 8px; border: 1px solid ${errorCount > 0 ? 'rgba(239, 68, 68, 0.3)' : 'transparent'};">
                <i class="fa-solid ${errorCount > 0 ? 'fa-triangle-exclamation' : 'fa-check'}" style="font-size: 11px; margin-right: 4px;"></i>${errorCount}
              </span>
            </td>
            <td style="text-align: right;"><b style="color: var(--accent-blue); font-size: 14px;">${formatNumber(s.total_views_latest || 0)}</b></td>
            <td style="text-align: right;"><span style="color: var(--accent-purple); font-weight: 700;">${formatNumber(s.total_posts || s.reported_post_count || Math.round(s.avg_posts_per_day || 0))}</span> bài</td>
            <td style="text-align: right;"><span style="color: var(--accent-emerald); font-weight: 700;">${s.avg_engagement_rate ? s.avg_engagement_rate.toFixed(2) : '0.00'}%</span></td>
            <td style="text-align: center;">
              <button class="btn btn-secondary btn-sm" onclick="filterMasterListByStaff('${escapeHtml(s.name)}')" style="padding: 4px 8px; font-size: 11px; white-space: nowrap;" title="Lọc các page của ${escapeHtml(s.name)}">
                <i class="fa-solid fa-filter"></i> Xem Page
              </button>
            </td>
          `;
          tbody.appendChild(tr);
        });
      }
    }
  } catch (err) {
    console.error('Failed to load staff:', err);
  }
}

function filterMasterListByStaff(staffName) {
  const searchInput = document.getElementById('searchMasterInput');
  if (searchInput) {
    searchInput.value = staffName;
    renderMasterPagesTable();
    showToast(`Đã lọc danh sách Fanpage của nhân sự: ${staffName}`);
    document.getElementById('masterPagesCard')?.scrollIntoView({ behavior: 'smooth' });
  }
}

async function loadMasterPagesTable() {
  try {
    let url = '/api/master-pages';
    if (currentUser.role !== 'admin') {
      url += `?staff_name=${encodeURIComponent(currentUser.name)}`;
    }
    const res = await fetch(url);
    const json = await res.json();
    if (!json.success) return;

    allMasterList = json.data;
    renderMasterPagesTable();
  } catch (err) {
    console.error('Failed to load master pages:', err);
  }
}

function renderMasterPagesTable() {
  const tbody = document.getElementById('masterPagesTableBody');
  if (!tbody) return;

  const searchTerm = (document.getElementById('searchMasterInput')?.value || '').toLowerCase().trim();
  let list = allMasterList;

  if (searchTerm) {
    list = list.filter(m => 
      m.page_name.toLowerCase().includes(searchTerm) ||
      (m.page_id && String(m.page_id).includes(searchTerm)) ||
      m.staff_name.toLowerCase().includes(searchTerm)
    );
  }

  tbody.innerHTML = '';
  if (list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:20px; color:var(--text-muted);">Chưa có danh sách phân bổ gốc nào.</td></tr>';
    return;
  }

  list.forEach(m => {
    const isError = (m.status || '').toLowerCase().includes('lỗi');
    const statusClass = isError ? 'error' : 'active';

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <strong>${escapeHtml(m.page_name)}</strong>
        ${m.page_id ? `<br><span style="font-size:11px; color:var(--text-dim); font-family:monospace;">ID: ${escapeHtml(m.page_id)}</span>` : ''}
      </td>
      <td>${getTopicBadge(m.topic)}</td>
      <td><span class="staff-badge assigned"><i class="fa-solid fa-user"></i> ${escapeHtml(m.staff_name)}</span></td>
      <td><span class="status-badge-pill ${statusClass}">${escapeHtml(m.status || m.sync_status || 'Active')}</span></td>
      <td>
        <button class="icon-btn danger" onclick="deleteMasterAssignment(${m.id})" title="Xóa phân bổ gốc">
          <i class="fa-regular fa-trash-can"></i>
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

async function deleteMasterAssignment(id) {
  if (!confirm('Bạn có chắc muốn xóa phân bổ gốc này?')) return;
  try {
    const res = await fetch(`/api/master-pages/${id}`, { method: 'DELETE' });
    const json = await res.json();
    if (json.success) {
      showToast(json.message);
      loadStaffData();
      loadMasterPagesTable();
      loadPagesTable();
    }
  } catch (err) {
    alert('Lỗi: ' + err.message);
  }
}

async function handleMasterFileUpload(e) {
  const file = e.target.files[0];
  if (!file) return;

  const formData = new FormData();
  formData.append('file', file);
  if (currentUser && currentUser.name) {
    formData.append('staff_name', currentUser.name);
  }

  showToast(currentUser?.role !== 'admin'
    ? `Đang nạp và tự động gán Fanpage cho ${currentUser.name}...`
    : 'Đang phân tích và nạp Danh sách Fanpage...');

  try {
    let url = '/api/master-pages/import';
    if (currentUser && currentUser.name) {
      url += `?staff_name=${encodeURIComponent(currentUser.name)}`;
    }
    const res = await fetch(url, {
      method: 'POST',
      body: formData
    });
    const json = await res.json();
    if (json.success) {
      showToast(json.message);
      loadStaffData();
      loadMasterPagesTable();
      loadPagesTable();
      loadTopicsData();
    } else {
      alert(json.error);
    }
  } catch (err) {
    alert('Lỗi: ' + err.message);
  } finally {
    e.target.value = '';
  }
}

async function deletePage(id, name) {
  if (!confirm(`Bạn có chắc chắn muốn xóa "${name}" và toàn bộ lịch sử chỉ số của trang này?`)) return;
  try {
    const res = await fetch(`/api/pages/${id}`, { method: 'DELETE' });
    const json = await res.json();
    if (json.success) {
      showToast(json.message);
      loadAllData();
    } else {
      alert(json.error);
    }
  } catch (err) {
    alert('Lỗi: ' + err.message);
  }
}

// ----------------------------------------------------
// 6. METRICS HISTORY TABLE
// ----------------------------------------------------
let currentHistoryData = [];
let currentHistorySort = { field: 'report_date', order: 'desc' };

function initHistorySorting() {
  document.querySelectorAll('#historyTable .sortable-th').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.getAttribute('data-col');
      if (currentHistorySort.field === col) {
        currentHistorySort.order = currentHistorySort.order === 'desc' ? 'asc' : 'desc';
      } else {
        currentHistorySort.field = col;
        currentHistorySort.order = 'desc';
      }
      renderSortedHistoryTable();
      updateHistorySortIcons();
    });
  });
}

function updateHistorySortIcons() {
  document.querySelectorAll('#historyTable .sortable-th').forEach(th => {
    const col = th.getAttribute('data-col');
    th.classList.remove('sorted', 'asc', 'desc');
    const icon = th.querySelector('.sort-icon');
    if (!icon) return;

    if (col === currentHistorySort.field) {
      th.classList.add('sorted', currentHistorySort.order);
      icon.className = `fa-solid fa-sort-${currentHistorySort.order === 'desc' ? 'down' : 'up'} sort-icon`;
    } else {
      icon.className = 'fa-solid fa-sort sort-icon';
    }
  });
}

async function loadHistoryTable() {
  try {
    const selectedPage = document.getElementById('filterHistoryPage').value;
    let url = '/api/metrics?limit=250';
    if (selectedPage && selectedPage !== 'all') {
      url += `&page_name=${encodeURIComponent(selectedPage)}`;
    }
    if (currentUser.role !== 'admin') {
      url += `&staff_name=${encodeURIComponent(currentUser.name)}`;
    }

    const res = await fetch(url);
    const json = await res.json();
    if (!json.success) return;

    currentHistoryData = json.data;
    renderSortedHistoryTable();
  } catch (err) {
    console.error('Failed to load history:', err);
  }
}

function renderSortedHistoryTable() {
  const tbody = document.getElementById('historyTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (currentHistoryData.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:30px; color:var(--text-muted);">Chưa có dữ liệu nào được ghi nhận.</td></tr>';
    return;
  }

  let sorted = [...currentHistoryData].sort((a, b) => {
    let valA = a[currentHistorySort.field] ?? 0;
    let valB = b[currentHistorySort.field] ?? 0;

    if (typeof valA === 'string') {
      return currentHistorySort.order === 'desc'
        ? valB.localeCompare(valA)
        : valA.localeCompare(valB);
    }

    return currentHistorySort.order === 'desc'
      ? Number(valB) - Number(valA)
      : Number(valA) - Number(valB);
  });

  sorted.forEach(r => {
    let fbUrl = '#';
    if (r.page_id && r.page_id.trim() !== '') {
      fbUrl = `https://facebook.com/${r.page_id.trim()}`;
    } else if (r.page_url && r.page_url.trim() !== '') {
      fbUrl = r.page_url;
    } else {
      fbUrl = `https://facebook.com/search/top?q=${encodeURIComponent(r.page_name)}`;
    }

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${r.report_date}</strong></td>
      <td>
        <a href="${escapeHtml(fbUrl)}" target="_blank" rel="noopener noreferrer" class="page-title-link" title="Mở Facebook: ${escapeHtml(fbUrl)}">
          <i class="fa-brands fa-facebook" style="color:#1877f2; font-size:14px; margin-right:4px;"></i>
          <strong>${escapeHtml(r.page_name)}</strong>
        </a>
      </td>
      <td><b style="color:var(--accent-blue)">${formatNumber(r.views)}</b></td>
      <td><b>${r.posts_per_day.toFixed(1)}</b></td>
      <td>${r.post_count}</td>
      <td>${formatNumber(r.interactions)}</td>
      <td><span style="color:var(--accent-emerald)">${r.engagement_rate.toFixed(2)}%</span></td>
      <td><small style="color:var(--text-dim)">${escapeHtml(r.source)}</small></td>
    `;
    tbody.appendChild(tr);
  });
}

function exportHistoryToCSV() {
  if (currentHistoryData.length === 0) {
    alert('Không có dữ liệu để xuất.');
    return;
  }

  const headers = ['Ngày Báo Cáo', 'Tên Fanpage', 'Lượt Xem (Views)', 'Posts / Day', 'Tổng Bài Đăng', 'Tương Tác', 'Tỷ Lệ ER (%)', 'Nguồn'];
  const rows = currentHistoryData.map(r => [
    r.report_date,
    `"${r.page_name.replace(/"/g, '""')}"`,
    r.views,
    r.posts_per_day,
    r.post_count,
    r.interactions,
    r.engagement_rate,
    `"${r.source}"`
  ]);

  const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `fanpage_karma_report_${new Date().toISOString().split('T')[0]}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// ----------------------------------------------------
// 7. FILE UPLOAD HANDLER
// ----------------------------------------------------
let selectedUploadFile = null;

function initUploadHandlers() {
  const dropZone = document.getElementById('dropZone');
  const fileInput = document.getElementById('fileInput');
  const uploadBtn = document.getElementById('btnUploadFile');
  const resultBox = document.getElementById('uploadResult');

  dropZone.addEventListener('click', () => fileInput.click());

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });

  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) {
      handleFileSelected(e.dataTransfer.files[0]);
    }
  });

  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      handleFileSelected(e.target.files[0]);
    }
  });

  function handleFileSelected(file) {
    selectedUploadFile = file;
    dropZone.querySelector('h4').innerText = `Đã chọn: ${file.name}`;
    dropZone.querySelector('p').innerText = `Dung lượng: ${(file.size / 1024).toFixed(1)} KB`;
    uploadBtn.disabled = false;
    resultBox.style.display = 'none';
  }

  uploadBtn.addEventListener('click', async () => {
    if (!selectedUploadFile) return;

    const formData = new FormData();
    formData.append('file', selectedUploadFile);

    uploadBtn.disabled = true;
    uploadBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang phân tích file...';

    try {
      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData
      });
      const json = await res.json();

      resultBox.style.display = 'block';
      if (json.success) {
        resultBox.className = 'upload-result-box success';
        resultBox.innerHTML = `<strong>Thành công!</strong> ${json.message}`;
        showToast('Nạp dữ liệu từ file thành công!');
        loadAllData();
      } else {
        resultBox.className = 'upload-result-box error';
        resultBox.innerHTML = `<strong>Lỗi:</strong> ${json.error}`;
      }
    } catch (err) {
      resultBox.style.display = 'block';
      resultBox.className = 'upload-result-box error';
      resultBox.innerHTML = `<strong>Lỗi kết nối:</strong> ${err.message}`;
    } finally {
      uploadBtn.disabled = false;
      uploadBtn.innerHTML = '<i class="fa-solid fa-bolt"></i> Xử Lý & Nạp Vào CRM';
    }
  });

  // Quick Upload directly inside Dashboard Báo Cáo Fanpage (with date selector modal)
  const btnDashboardQuickUpload = document.getElementById('btnDashboardQuickUpload');
  const uploadKarmaModal = document.getElementById('uploadKarmaModal');
  const btnCloseUploadKarmaModal = document.getElementById('btnCloseUploadKarmaModal');
  const btnCancelUploadKarmaModal = document.getElementById('btnCancelUploadKarmaModal');
  const uploadKarmaForm = document.getElementById('uploadKarmaForm');
  const dropZoneKarmaUpload = document.getElementById('dropZoneKarmaUpload');
  const modalKarmaFileInput = document.getElementById('modalKarmaFileInput');
  const uploadKarmaFileName = document.getElementById('uploadKarmaFileName');
  const uploadKarmaReportDate = document.getElementById('uploadKarmaReportDate');
  const uploadKarmaStaffName = document.getElementById('uploadKarmaStaffName');
  const btnSetUploadDateToday = document.getElementById('btnSetUploadDateToday');
  const btnSetUploadDateYesterday = document.getElementById('btnSetUploadDateYesterday');

  // Helper to open upload modal
  function openUploadKarmaModal() {
    if (!uploadKarmaModal) return;
    const todayStr = formatDateObj(new Date());
    
    // Set min/max allowed date
    if (uploadKarmaReportDate) {
      uploadKarmaReportDate.max = todayStr;
      uploadKarmaReportDate.value = currentEndDate || currentSelectedReportDate || todayStr;
    }

    if (uploadKarmaStaffName) {
      uploadKarmaStaffName.value = currentUser?.name || 'Admin';
    }

    if (modalKarmaFileInput) modalKarmaFileInput.value = '';
    if (uploadKarmaFileName) uploadKarmaFileName.innerHTML = 'Bấm để chọn file hoặc kéo thả vào đây';
    if (dropZoneKarmaUpload) dropZoneKarmaUpload.style.borderColor = 'rgba(59, 130, 246, 0.4)';

    uploadKarmaModal.classList.add('active');
  }

  function closeUploadKarmaModal() {
    uploadKarmaModal?.classList.remove('active');
  }

  btnDashboardQuickUpload?.addEventListener('click', openUploadKarmaModal);
  btnCloseUploadKarmaModal?.addEventListener('click', closeUploadKarmaModal);
  btnCancelUploadKarmaModal?.addEventListener('click', closeUploadKarmaModal);

  // Click drop zone to select file
  dropZoneKarmaUpload?.addEventListener('click', () => {
    modalKarmaFileInput?.click();
  });

  // Drag & Drop
  dropZoneKarmaUpload?.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZoneKarmaUpload.style.borderColor = '#3b82f6';
    dropZoneKarmaUpload.style.background = 'rgba(59, 130, 246, 0.15)';
  });
  dropZoneKarmaUpload?.addEventListener('dragleave', () => {
    dropZoneKarmaUpload.style.borderColor = 'rgba(59, 130, 246, 0.4)';
    dropZoneKarmaUpload.style.background = 'rgba(59, 130, 246, 0.05)';
  });
  dropZoneKarmaUpload?.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZoneKarmaUpload.style.borderColor = 'rgba(59, 130, 246, 0.4)';
    dropZoneKarmaUpload.style.background = 'rgba(59, 130, 246, 0.05)';
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      modalKarmaFileInput.files = e.dataTransfer.files;
      handleSelectedKarmaFile(e.dataTransfer.files[0]);
    }
  });

  modalKarmaFileInput?.addEventListener('change', (e) => {
    if (e.target.files && e.target.files.length > 0) {
      handleSelectedKarmaFile(e.target.files[0]);
    }
  });

  function handleSelectedKarmaFile(file) {
    if (!file) return;
    const sizeKb = (file.size / 1024).toFixed(1);
    if (uploadKarmaFileName) {
      uploadKarmaFileName.innerHTML = `<span style="color: #60a5fa;"><i class="fa-solid fa-file-csv"></i> ${file.name}</span> <span style="font-size: 11px; color: var(--text-muted);">(${sizeKb} KB)</span>`;
    }

    // Auto detect date from filename if present
    const m1 = file.name.match(/(20\d{2})[-_./](0[1-9]|1[0-2])[-_./](0[1-9]|[12]\d|3[01])/);
    if (m1 && uploadKarmaReportDate) {
      uploadKarmaReportDate.value = `${m1[1]}-${m1[2]}-${m1[3]}`;
    } else {
      const m2 = file.name.match(/(0[1-9]|[12]\d|3[01])[-_./](0[1-9]|1[0-2])[-_./](20\d{2})/);
      if (m2 && uploadKarmaReportDate) {
        uploadKarmaReportDate.value = `${m2[3]}-${m2[2]}-${m2[1]}`;
      }
    }
  }

  // Quick Date Shortcut buttons in Modal
  btnSetUploadDateToday?.addEventListener('click', () => {
    if (uploadKarmaReportDate) {
      uploadKarmaReportDate.value = formatDateObj(new Date());
    }
  });

  btnSetUploadDateYesterday?.addEventListener('click', () => {
    if (uploadKarmaReportDate) {
      const d = new Date();
      d.setDate(d.getDate() - 1);
      uploadKarmaReportDate.value = formatDateObj(d);
    }
  });

  // Handle Form Submit
  uploadKarmaForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!modalKarmaFileInput.files || modalKarmaFileInput.files.length === 0) {
      alert('Vui lòng chọn file báo cáo trước khi nạp!');
      return;
    }

    const file = modalKarmaFileInput.files[0];
    const chosenDate = uploadKarmaReportDate.value || formatDateObj(new Date());

    const todayStr = formatDateObj(new Date());
    if (chosenDate > todayStr) {
      alert('Không thể chọn ngày báo cáo trong tương lai!');
      return;
    }

    const formData = new FormData();
    formData.append('file', file);
    formData.append('report_date', chosenDate);
    if (currentUser && currentUser.name) {
      formData.append('staff_name', currentUser.name);
    }

    const btnSubmit = document.getElementById('btnSubmitUploadKarma');
    const oldBtnContent = btnSubmit.innerHTML;
    btnSubmit.disabled = true;
    btnSubmit.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang nạp dữ liệu...';
    showToast(`Đang nạp dữ liệu cho ngày: ${chosenDate}...`);

    try {
      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData
      });
      const json = await res.json();
      if (json.success) {
        closeUploadKarmaModal();
        showToast(`🎉 Nạp thành công báo cáo ngày ${chosenDate}! (${json.count} fanpage)`);
        
        // Auto set view date to the uploaded date so user sees data immediately
        currentStartDate = chosenDate;
        currentEndDate = chosenDate;
        currentSelectedReportDate = chosenDate;
        updateSelectedDateDisplay();
        loadAllData();
      } else {
        alert('Lỗi nạp file: ' + json.error);
      }
    } catch (err) {
      alert('Lỗi kết nối khi nạp file: ' + err.message);
    } finally {
      btnSubmit.disabled = false;
      btnSubmit.innerHTML = oldBtnContent;
    }
  });
}

// ----------------------------------------------------
// 8. SETTINGS & WEBHOOK LOGS
// ----------------------------------------------------
async function loadSettings() {
  try {
    const res = await fetch('/api/settings');
    const json = await res.json();
    if (json.success) {
      document.getElementById('webhookUrlInput').value = `${window.location.origin}/api/webhook/fanpagekarma`;
      document.getElementById('apiKeyInput').value = json.data.apiKey;
    }
  } catch (err) {
    console.error('Failed to load settings:', err);
  }
}

async function saveApiKey() {
  const newKey = document.getElementById('apiKeyInput').value.trim();
  if (!newKey) {
    alert('API Key không được để trống.');
    return;
  }
  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: newKey })
    });
    const json = await res.json();
    if (json.success) {
      showToast('Đã lưu API Key mới!');
    }
  } catch (err) {
    alert('Lỗi: ' + err.message);
  }
}

function copyWebhookUrl() {
  const input = document.getElementById('webhookUrlInput');
  input.select();
  navigator.clipboard.writeText(input.value);
  showToast('Đã sao chép Webhook URL vào clipboard!');
}

async function loadWebhookLogs() {
  try {
    const res = await fetch('/api/webhook-logs');
    const json = await res.json();
    if (!json.success) return;

    const container = document.getElementById('webhookLogsContainer');
    container.innerHTML = '';

    if (json.data.length === 0) {
      container.innerHTML = '<p style="color:var(--text-muted); font-size:13px; text-align:center; padding:20px;">Chưa có nhật ký Webhook nào.</p>';
      return;
    }

    json.data.forEach(log => {
      const item = document.createElement('div');
      item.className = 'log-item';
      
      let statusClass = 'success';
      if (log.status === 'ERROR') statusClass = 'error';
      if (log.status === 'EMPTY') statusClass = 'empty';

      item.innerHTML = `
        <div class="log-header">
          <span class="log-status ${statusClass}">${log.status}</span>
          <span class="log-time">${log.created_at}</span>
        </div>
        <div class="log-msg">${escapeHtml(log.message || '')}</div>
        <small style="color:var(--text-dim)">Người gửi: ${escapeHtml(log.sender_email || 'maiduc2311@gmail.com')} | Bản ghi: ${log.record_count}</small>
      `;
      container.appendChild(item);
    });
  } catch (err) {
    console.error('Failed to load logs:', err);
  }
}

// ----------------------------------------------------
// 9. UTILS & HELPERS
// ----------------------------------------------------
function formatNumber(num) {
  if (num === null || num === undefined) return '0';
  return Number(num).toLocaleString('vi-VN');
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length === 3) return `${parts[2]}/${parts[1]}`;
  return dateStr;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.innerText = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3000);
}

// ----------------------------------------------------
// 10. TOPIC ANALYTICS & THEMES CONTROLLER
// ----------------------------------------------------
let allTopicsData = [];
let currentTopicsSort = { field: 'views', order: 'desc' };
let topicViewsChartInstance = null;
let topicEfficiencyChartInstance = null;

function initTopicsEventListeners() {
  // Topic quick sort pills
  document.querySelectorAll('.rank-pill[data-topic-sort]').forEach(pill => {
    pill.addEventListener('click', (e) => {
      document.querySelectorAll('.rank-pill[data-topic-sort]').forEach(p => p.classList.remove('active'));
      const btn = e.currentTarget;
      btn.classList.add('active');

      const sortField = btn.getAttribute('data-topic-sort');
      currentTopicsSort = { field: sortField, order: 'desc' };
      renderTopicsTable();
      updateTopicSortHeaderIcons();
    });
  });

  // Table header sorting
  document.querySelectorAll('#topicsTable .sortable-th[data-topic-col]').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.getAttribute('data-topic-col');
      if (currentTopicsSort.field === col) {
        currentTopicsSort.order = currentTopicsSort.order === 'desc' ? 'asc' : 'desc';
      } else {
        currentTopicsSort.field = col;
        currentTopicsSort.order = 'desc';
      }

      document.querySelectorAll('.rank-pill[data-topic-sort]').forEach(p => {
        if (p.getAttribute('data-topic-sort') === col && currentTopicsSort.order === 'desc') {
          p.classList.add('active');
        } else {
          p.classList.remove('active');
        }
      });

      renderTopicsTable();
      updateTopicSortHeaderIcons();
    });
  });

  // Search topic input
  let searchTimeout = null;
  document.getElementById('searchTopicsInput')?.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      renderTopicsTable();
    }, 200);
  });

  // Export CSV Topics
  document.getElementById('btnExportTopicsCSV')?.addEventListener('click', exportTopicsToCSV);

  // Close Topic Detail Modal
  document.getElementById('btnCloseTopicDetailModal')?.addEventListener('click', () => {
    document.getElementById('topicDetailModal')?.classList.remove('active');
  });
}

function updateTopicSortHeaderIcons() {
  document.querySelectorAll('#topicsTable .sortable-th[data-topic-col]').forEach(th => {
    th.classList.remove('sorted', 'asc', 'desc');
    const icon = th.querySelector('.sort-icon');
    if (icon) icon.className = 'fa-solid fa-sort sort-icon';

    if (th.getAttribute('data-topic-col') === currentTopicsSort.field) {
      th.classList.add('sorted', currentTopicsSort.order);
      if (icon) {
        icon.className = currentTopicsSort.order === 'desc'
          ? 'fa-solid fa-sort-down sort-icon'
          : 'fa-solid fa-sort-up sort-icon';
      }
    }
  });
}

async function loadTopicsData() {
  try {
    let url = '/api/topics';
    if (currentUser.role !== 'admin') {
      url += `?staff_name=${encodeURIComponent(currentUser.name)}`;
    }
    const res = await fetch(url);
    const json = await res.json();
    if (!json.success) return;

    allTopicsData = json.data || [];
    const summary = json.summary || {};

    // Update Nav Count
    const navCount = document.getElementById('navTopicsCount');
    if (navCount) navCount.innerText = allTopicsData.length;

    // Update KPI Cards
    const kpiViewsName = document.getElementById('kpiTopTopicViewsName');
    const kpiViewsVal = document.getElementById('kpiTopTopicViewsVal');
    if (summary.topViewsTopic) {
      if (kpiViewsName) kpiViewsName.innerText = summary.topViewsTopic.topic_name;
      if (kpiViewsVal) kpiViewsVal.innerText = `${formatNumber(summary.topViewsTopic.total_views)} views`;
    } else {
      if (kpiViewsName) kpiViewsName.innerText = 'Chưa có';
      if (kpiViewsVal) kpiViewsVal.innerText = '0 views';
    }

    const kpiGrowthName = document.getElementById('kpiTopTopicGrowthName');
    const kpiGrowthVal = document.getElementById('kpiTopTopicGrowthVal');
    if (summary.topGrowthTopic) {
      if (kpiGrowthName) kpiGrowthName.innerText = summary.topGrowthTopic.topic_name;
      if (kpiGrowthVal) kpiGrowthVal.innerText = `${summary.topGrowthTopic.growth_rate >= 0 ? '+' : ''}${summary.topGrowthTopic.growth_rate}%`;
    } else {
      if (kpiGrowthName) kpiGrowthName.innerText = 'Chưa có';
      if (kpiGrowthVal) kpiGrowthVal.innerText = '+0%';
    }

    const kpiPostsName = document.getElementById('kpiTopTopicPostsName');
    const kpiPostsVal = document.getElementById('kpiTopTopicPostsVal');
    if (summary.topPostsTopic) {
      if (kpiPostsName) kpiPostsName.innerText = summary.topPostsTopic.topic_name;
      if (kpiPostsVal) kpiPostsVal.innerText = `${summary.topPostsTopic.avg_posts_per_day} bài/ngày`;
    } else {
      if (kpiPostsName) kpiPostsName.innerText = 'Chưa có';
      if (kpiPostsVal) kpiPostsVal.innerText = '0 bài/ngày';
    }

    const kpiTotal = document.getElementById('kpiTotalTopicsCount');
    if (kpiTotal) kpiTotal.innerText = allTopicsData.length;

    // Render Table and Charts
    renderTopicsTable();
    renderTopicsCharts(allTopicsData);
  } catch (err) {
    console.error('Failed to load topics:', err);
  }
}

function renderTopicsTable() {
  const tbody = document.getElementById('topicsTableBody');
  if (!tbody) return;

  const searchTerm = (document.getElementById('searchTopicsInput')?.value || '').toLowerCase().trim();

  let list = [...allTopicsData];

  // Filter search
  if (searchTerm) {
    list = list.filter(t => 
      t.topic_name.toLowerCase().includes(searchTerm) ||
      (t.top_page && t.top_page.name.toLowerCase().includes(searchTerm))
    );
  }

  // Sorting
  list.sort((a, b) => {
    let valA = a.total_views;
    let valB = b.total_views;

    if (currentTopicsSort.field === 'growth') {
      valA = a.growth_rate; valB = b.growth_rate;
    } else if (currentTopicsSort.field === 'posts') {
      valA = a.avg_posts_per_day; valB = b.avg_posts_per_day;
    } else if (currentTopicsSort.field === 'interactions') {
      valA = a.total_interactions; valB = b.total_interactions;
    } else if (currentTopicsSort.field === 'er') {
      valA = a.avg_engagement_rate; valB = b.avg_engagement_rate;
    } else if (currentTopicsSort.field === 'pages') {
      valA = a.page_count; valB = b.page_count;
    }

    return currentTopicsSort.order === 'desc' ? valB - valA : valA - valB;
  });

  tbody.innerHTML = '';
  if (list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="11" style="text-align:center; padding:30px; color:var(--text-muted);">Chưa có dữ liệu chủ đề nào phù hợp.</td></tr>';
    return;
  }

  list.forEach((t, index) => {
    const rank = index + 1;
    let rankBadgeClass = 'rank-normal';
    if (rank === 1) rankBadgeClass = 'rank-1';
    else if (rank === 2) rankBadgeClass = 'rank-2';
    else if (rank === 3) rankBadgeClass = 'rank-3';

    const growthClass = t.growth_rate >= 0 ? 'positive' : 'negative';
    const growthIcon = t.growth_rate >= 0 ? '<i class="fa-solid fa-arrow-trend-up"></i>' : '<i class="fa-solid fa-arrow-trend-down"></i>';

    const topPageHtml = t.top_page ? `
      <div style="font-size:13px; font-weight:700; color:var(--text-main);">
        <i class="fa-brands fa-facebook" style="color:#1877f2; margin-right:4px;"></i>${escapeHtml(t.top_page.name)}
      </div>
      <div style="font-size:11px; color:var(--text-dim);">
        ${formatNumber(t.top_page.views)} views · ${t.top_page.staff_name || 'Chưa gán'}
      </div>
    ` : '<span style="color:var(--text-muted);">Chưa có</span>';

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <span class="rank-badge ${rankBadgeClass}">
          ${rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : rank}
        </span>
      </td>
      <td>
        <div style="display:flex; align-items:center; gap:8px;">
          ${getTopicBadge(t.topic_name)}
        </div>
      </td>
      <td style="text-align:center;">
        <span class="badge" style="background:rgba(99,102,241,0.15); color:#818cf8; font-weight:700; padding:3px 8px; border-radius:10px;">
          ${t.page_count} page
        </span>
      </td>
      <td style="text-align:right;">
        <b style="color:var(--accent-blue); font-size:14px;">${formatNumber(t.total_views)}</b>
      </td>
      <td style="text-align:right;">
        <span class="growth-badge ${growthClass}">
          ${growthIcon} ${t.growth_rate >= 0 ? '+' : ''}${t.growth_rate}%
        </span>
      </td>
      <td style="text-align:right;">
        <span style="color:var(--accent-purple); font-weight:700;">${t.avg_posts_per_day.toFixed(1)}</span> <small style="color:var(--text-dim);">bài/ngày</small>
      </td>
      <td style="text-align:right;">
        <b>${formatNumber(t.total_interactions)}</b>
      </td>
      <td style="text-align:right;">
        <span style="color:var(--accent-emerald); font-weight:700;">${t.avg_engagement_rate.toFixed(2)}%</span>
      </td>
      <td style="text-align:center;">
        <span class="topic-rating-badge ${t.ratingClass}">
          ${escapeHtml(t.rating)}
        </span>
      </td>
      <td>${topPageHtml}</td>
      <td style="text-align:center;">
        <button class="btn btn-secondary btn-sm" onclick="showTopicDetailModal('${escapeHtml(t.topic_name)}')" title="Xem danh sách Page trong chủ đề">
          <i class="fa-solid fa-layer-group"></i> Xem
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function renderTopicsCharts(data) {
  if (!data || data.length === 0) return;

  const isLight = document.body.classList.contains('light-theme');
  const textColor = isLight ? '#1e293b' : '#94a3b8';
  const gridColor = isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.06)';

  // Chart 1: Topic Views Comparison
  const ctxViews = document.getElementById('topicViewsChart')?.getContext('2d');
  if (ctxViews) {
    if (topicViewsChartInstance) topicViewsChartInstance.destroy();

    const labels = data.map(t => t.topic_name);
    const viewsData = data.map(t => t.total_views);

    topicViewsChartInstance = new Chart(ctxViews, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Tổng Lượt Xem (Views)',
          data: viewsData,
          backgroundColor: [
            'rgba(245, 158, 11, 0.75)',
            'rgba(168, 85, 247, 0.75)',
            'rgba(6, 182, 212, 0.75)',
            'rgba(16, 185, 129, 0.75)',
            'rgba(99, 102, 241, 0.75)',
            'rgba(236, 72, 153, 0.75)'
          ],
          borderRadius: 8
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => ` Views: ${formatNumber(ctx.parsed.y)}`
            }
          }
        },
        scales: {
          x: {
            ticks: { color: textColor, font: { size: 11, weight: '600' } },
            grid: { display: false }
          },
          y: {
            ticks: { color: textColor, callback: (v) => formatNumber(v) },
            grid: { color: gridColor }
          }
        }
      }
    });
  }

  // Chart 2: Posts/day & ER Comparison
  const ctxEff = document.getElementById('topicEfficiencyChart')?.getContext('2d');
  if (ctxEff) {
    if (topicEfficiencyChartInstance) topicEfficiencyChartInstance.destroy();

    const labels = data.map(t => t.topic_name);
    const postsData = data.map(t => t.avg_posts_per_day);
    const erData = data.map(t => t.avg_engagement_rate);

    topicEfficiencyChartInstance = new Chart(ctxEff, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Tần Suất Đăng (Bài/Ngày)',
            data: postsData,
            backgroundColor: 'rgba(168, 85, 247, 0.75)',
            yAxisID: 'y',
            borderRadius: 6
          },
          {
            label: 'Tỷ Lệ ER (%)',
            data: erData,
            type: 'line',
            borderColor: '#10b981',
            backgroundColor: '#10b981',
            borderWidth: 3,
            tension: 0.3,
            yAxisID: 'y1',
            pointRadius: 5
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            labels: { color: textColor, font: { weight: '600', size: 12 } }
          }
        },
        scales: {
          x: {
            ticks: { color: textColor, font: { size: 11, weight: '600' } },
            grid: { display: false }
          },
          y: {
            type: 'linear',
            display: true,
            position: 'left',
            ticks: { color: '#c084fc' },
            grid: { color: gridColor },
            title: { display: true, text: 'Bài / Ngày', color: '#c084fc' }
          },
          y1: {
            type: 'linear',
            display: true,
            position: 'right',
            grid: { drawOnChartArea: false },
            ticks: { color: '#10b981', callback: (v) => `${v}%` },
            title: { display: true, text: 'Tỷ lệ ER %', color: '#10b981' }
          }
        }
      }
    });
  }
}

let currentTopicDetailObj = null;
let currentTopicDetailSort = { field: 'views', order: 'desc' };
let currentTopicDetailSearch = '';

function showTopicDetailModal(topicName) {
  const topic = allTopicsData.find(t => t.topic_name === topicName);
  if (!topic) return;

  currentTopicDetailObj = topic;
  currentTopicDetailSort = { field: 'views', order: 'desc' };
  currentTopicDetailSearch = '';

  const modal = document.getElementById('topicDetailModal');
  const titleEl = document.getElementById('topicDetailTitle');
  const bodyEl = document.getElementById('topicDetailBody');

  if (titleEl) {
    titleEl.innerHTML = `<i class="fa-solid fa-shapes"></i> Bảng Xếp Hạng Fanpage: ${escapeHtml(topic.topic_name)} (${topic.page_count} Fanpage)`;
  }

  if (bodyEl) {
    bodyEl.innerHTML = `
      <div class="kpi-grid" style="grid-template-columns: repeat(4, 1fr); margin-bottom: 16px;">
        <div class="kpi-card glass-card" style="padding:12px;">
          <span class="kpi-label">Tổng Views</span>
          <h4 style="color:var(--accent-blue); margin:4px 0 0 0; font-size:18px;">${formatNumber(topic.total_views)}</h4>
        </div>
        <div class="kpi-card glass-card" style="padding:12px;">
          <span class="kpi-label">Tăng Trưởng</span>
          <h4 style="color:${topic.growth_rate >= 0 ? '#10b981' : '#f43f5e'}; margin:4px 0 0 0; font-size:18px;">
            ${topic.growth_rate >= 0 ? '+' : ''}${topic.growth_rate}%
          </h4>
        </div>
        <div class="kpi-card glass-card" style="padding:12px;">
          <span class="kpi-label">Số Lượng Bài Viết</span>
          <h4 style="color:var(--accent-purple); margin:4px 0 0 0; font-size:18px;">${topic.total_posts || topic.avg_posts_per_day} bài</h4>
        </div>
        <div class="kpi-card glass-card" style="padding:12px;">
          <span class="kpi-label">Tỷ Lệ ER TB</span>
          <h4 style="color:var(--accent-emerald); margin:4px 0 0 0; font-size:18px;">${topic.avg_engagement_rate}%</h4>
        </div>
      </div>

      <!-- Inner Ranking & Search Toolbar -->
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; margin-bottom:12px;">
        <div class="ranking-toolbar" style="margin-bottom:0; padding:4px 0;">
          <span class="ranking-label"><i class="fa-solid fa-arrow-down-wide-short"></i> Xếp hạng:</span>
          <button class="rank-pill active" data-topic-modal-sort="views">
            <i class="fa-solid fa-eye"></i> Top Views
          </button>
          <button class="rank-pill" data-topic-modal-sort="interactions">
            <i class="fa-solid fa-heart-pulse"></i> Top Tương Tác
          </button>
          <button class="rank-pill" data-topic-modal-sort="posts_per_day">
            <i class="fa-solid fa-newspaper"></i> Top Số Bài
          </button>
          <button class="rank-pill" data-topic-modal-sort="engagement_rate">
            <i class="fa-solid fa-bolt"></i> Top ER (%)
          </button>
          <button class="rank-pill" data-topic-modal-sort="page_name">
            <i class="fa-solid fa-arrow-down-a-z"></i> Tên A-Z
          </button>
        </div>

        <div style="display:flex; gap:8px; align-items:center;">
          <div class="table-search-box" style="margin-bottom:0; min-width:220px;">
            <i class="fa-solid fa-magnifying-glass"></i>
            <input type="text" id="searchTopicModalPages" placeholder="Lọc theo tên Fanpage / NV...">
          </div>
          <button class="btn btn-secondary btn-sm" id="btnExportTopicDetailCSV" title="Xuất CSV danh sách Fanpage">
            <i class="fa-solid fa-file-export"></i> Xuất CSV
          </button>
        </div>
      </div>

      <div class="table-responsive" style="max-height: 420px; overflow-y: auto;">
        <table class="data-table" id="topicDetailTable">
          <thead>
            <tr>
              <th style="width: 60px; text-align: center;"># Hạng</th>
              <th class="sortable-th" data-tm-col="page_name">Fanpage <i class="fa-solid fa-sort sort-icon"></i></th>
              <th class="sortable-th" data-tm-col="staff_name">Nhân Sự Phụ Trách <i class="fa-solid fa-sort sort-icon"></i></th>
              <th class="sortable-th sorted desc" data-tm-col="views" style="text-align:right;">Views <i class="fa-solid fa-sort-down sort-icon"></i></th>
              <th class="sortable-th" data-tm-col="posts_per_day" style="text-align:right;">Number of posts <i class="fa-solid fa-sort sort-icon"></i></th>
              <th class="sortable-th" data-tm-col="interactions" style="text-align:right;">Tương Tác <i class="fa-solid fa-sort sort-icon"></i></th>
              <th class="sortable-th" data-tm-col="engagement_rate" style="text-align:right;">Tỷ Lệ ER <i class="fa-solid fa-sort sort-icon"></i></th>
              <th style="text-align:center; width:75px;">Link</th>
            </tr>
          </thead>
          <tbody id="topicDetailTableBody">
            <!-- Rendered by renderTopicDetailTable -->
          </tbody>
        </table>
      </div>
    `;

    // Hook ranking pills in modal
    bodyEl.querySelectorAll('.rank-pill[data-topic-modal-sort]').forEach(pill => {
      pill.addEventListener('click', (e) => {
        bodyEl.querySelectorAll('.rank-pill[data-topic-modal-sort]').forEach(p => p.classList.remove('active'));
        const btn = e.currentTarget;
        btn.classList.add('active');
        const sortField = btn.getAttribute('data-topic-modal-sort');
        currentTopicDetailSort = { field: sortField, order: sortField === 'page_name' ? 'asc' : 'desc' };
        renderTopicDetailTable();
      });
    });

    // Hook sortable th
    bodyEl.querySelectorAll('#topicDetailTable .sortable-th[data-tm-col]').forEach(th => {
      th.addEventListener('click', () => {
        const col = th.getAttribute('data-tm-col');
        if (currentTopicDetailSort.field === col) {
          currentTopicDetailSort.order = currentTopicDetailSort.order === 'desc' ? 'asc' : 'desc';
        } else {
          currentTopicDetailSort.field = col;
          currentTopicDetailSort.order = col === 'page_name' || col === 'staff_name' ? 'asc' : 'desc';
        }

        bodyEl.querySelectorAll('.rank-pill[data-topic-modal-sort]').forEach(p => {
          if (p.getAttribute('data-topic-modal-sort') === col) {
            p.classList.add('active');
          } else {
            p.classList.remove('active');
          }
        });

        renderTopicDetailTable();
      });
    });

    // Hook search
    const searchInput = document.getElementById('searchTopicModalPages');
    searchInput?.addEventListener('input', (e) => {
      currentTopicDetailSearch = e.target.value.toLowerCase().trim();
      renderTopicDetailTable();
    });

    // Hook Export CSV
    document.getElementById('btnExportTopicDetailCSV')?.addEventListener('click', () => {
      exportSingleTopicPagesToCSV(topic);
    });

    renderTopicDetailTable();
  }

  modal?.classList.add('active');
}

function renderTopicDetailTable() {
  if (!currentTopicDetailObj) return;

  const tbody = document.getElementById('topicDetailTableBody');
  if (!tbody) return;

  // Update th icons
  document.querySelectorAll('#topicDetailTable .sortable-th[data-tm-col]').forEach(th => {
    th.classList.remove('sorted', 'asc', 'desc');
    const icon = th.querySelector('.sort-icon');
    if (icon) icon.className = 'fa-solid fa-sort sort-icon';

    if (th.getAttribute('data-tm-col') === currentTopicDetailSort.field) {
      th.classList.add('sorted', currentTopicDetailSort.order);
      if (icon) {
        icon.className = currentTopicDetailSort.order === 'desc'
          ? 'fa-solid fa-sort-down sort-icon'
          : 'fa-solid fa-sort-up sort-icon';
      }
    }
  });

  let list = [...currentTopicDetailObj.pages];

  // Search filter
  if (currentTopicDetailSearch) {
    list = list.filter(p => 
      p.page_name.toLowerCase().includes(currentTopicDetailSearch) ||
      (p.page_id && String(p.page_id).includes(currentTopicDetailSearch)) ||
      (p.staff_name && p.staff_name.toLowerCase().includes(currentTopicDetailSearch))
    );
  }

  // Sort
  list.sort((a, b) => {
    let valA = a[currentTopicDetailSort.field] ?? 0;
    let valB = b[currentTopicDetailSort.field] ?? 0;

    if (typeof valA === 'string') {
      return currentTopicDetailSort.order === 'desc'
        ? String(valB).localeCompare(String(valA))
        : String(valA).localeCompare(String(valB));
    }

    return currentTopicDetailSort.order === 'desc'
      ? Number(valB) - Number(valA)
      : Number(valA) - Number(valB);
  });

  tbody.innerHTML = '';
  if (list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:24px; color:var(--text-muted);">Không tìm thấy Fanpage nào phù hợp.</td></tr>';
    return;
  }

  list.forEach((p, idx) => {
    const rank = idx + 1;
    let rankBadgeClass = 'rank-normal';
    if (rank === 1) rankBadgeClass = 'rank-1';
    else if (rank === 2) rankBadgeClass = 'rank-2';
    else if (rank === 3) rankBadgeClass = 'rank-3';

    const fbUrl = p.page_url || (p.page_id ? `https://facebook.com/${p.page_id}` : `https://facebook.com/search/top?q=${encodeURIComponent(p.page_name)}`);

    const avatarHtml = p.avatar_url && p.avatar_url.trim() !== ''
      ? `<img src="${escapeHtml(p.avatar_url)}" alt="Avatar" style="width:28px; height:28px; border-radius:50%; object-fit:cover; border:1px solid var(--border-color);" onerror="this.style.display='none'">`
      : `<div style="width:28px; height:28px; border-radius:50%; background:rgba(24,119,242,0.15); color:#1877f2; display:flex; align-items:center; justify-content:center; font-size:12px;"><i class="fa-brands fa-facebook-f"></i></div>`;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="text-align: center;">
        <span class="rank-badge ${rankBadgeClass}">
          ${rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : rank}
        </span>
      </td>
      <td>
        <div style="display:flex; align-items:center; gap:8px;">
          ${avatarHtml}
          <div>
            <strong>${escapeHtml(p.page_name)}</strong>
            ${p.page_id ? `<br><small style="color:var(--text-dim); font-family:monospace; font-size:11px;">ID: ${escapeHtml(p.page_id)}</small>` : ''}
          </div>
        </div>
      </td>
      <td><span class="staff-badge assigned"><i class="fa-solid fa-user"></i> ${escapeHtml(p.staff_name || 'Chưa gán')}</span></td>
      <td style="text-align:right;"><b style="color:var(--accent-blue); font-size:14px;">${formatNumber(p.views || 0)}</b></td>
      <td style="text-align:right;"><span style="color:var(--accent-purple); font-weight:700;">${p.post_count !== undefined && p.post_count !== null ? p.post_count : formatNumber(p.posts_per_day || 0)}</span> bài</td>
      <td style="text-align:right;"><b>${formatNumber(p.interactions || 0)}</b></td>
      <td style="text-align:right;"><span style="color:var(--accent-emerald); font-weight:700;">${(p.engagement_rate || 0).toFixed(2)}%</span></td>
      <td style="text-align:center;">
        <a href="${escapeHtml(fbUrl)}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-sm" style="padding:3px 8px; font-size:11px; white-space:nowrap;">
          <i class="fa-brands fa-facebook"></i> Mở FB
        </a>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function exportSingleTopicPagesToCSV(topic) {
  if (!topic || !topic.pages || topic.pages.length === 0) {
    alert('Không có dữ liệu fanpage để xuất.');
    return;
  }

  const headers = ['Hạng', 'Tên Fanpage', 'ID Page', 'Nhân Sự Phụ Trách', 'Views', 'Posts / Day', 'Tương Tác', 'Tỷ Lệ ER (%)', 'Facebook URL'];
  
  // Sort by views desc
  const sorted = [...topic.pages].sort((a, b) => (b.views || 0) - (a.views || 0));

  const rows = sorted.map((p, idx) => [
    idx + 1,
    `"${(p.page_name || '').replace(/"/g, '""')}"`,
    `"${p.page_id || ''}"`,
    `"${p.staff_name || ''}"`,
    p.views || 0,
    (p.posts_per_day || 0).toFixed(1),
    p.interactions || 0,
    (p.engagement_rate || 0).toFixed(2),
    `"${p.page_url || (p.page_id ? `https://facebook.com/${p.page_id}` : '')}"`
  ]);

  const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `xep_hang_chu_de_${(topic.topic_name || 'topic').replace(/[\s\/\\]/g, '_')}_${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast(`Đã xuất CSV xếp hạng cho chủ đề ${topic.topic_name}!`);
}

function exportTopicsToCSV() {
  if (allTopicsData.length === 0) {
    alert('Không có dữ liệu chủ đề để xuất.');
    return;
  }

  const headers = [
    'Chủ Đề Nội Dung',
    'Số Lượng Page',
    'Tổng Views',
    'Tăng Trưởng Views (%)',
    'Tần Suất Đăng (Bài/Ngày)',
    'Tổng Tương Tác',
    'Tỷ Lệ ER (%)',
    'Đánh Giá Hiệu Quả',
    'Fanpage Dẫn Đầu'
  ];

  const rows = allTopicsData.map(t => [
    `"${(t.topic_name || '').replace(/"/g, '""')}"`,
    t.page_count || 0,
    t.total_views || 0,
    `"${t.growth_rate >= 0 ? '+' : ''}${t.growth_rate}%"`,
    t.avg_posts_per_day || 0,
    t.total_interactions || 0,
    t.avg_engagement_rate || 0,
    `"${t.rating || ''}"`,
    `"${(t.top_page?.name || '').replace(/"/g, '""')}"`
  ]);

  const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `phan_tich_chu_de_${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Đã xuất file CSV Phân Tích Chủ Đề thành công!');
}
