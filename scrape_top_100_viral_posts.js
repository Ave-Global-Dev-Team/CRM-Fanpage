const http = require('http');
const WebSocket = require('ws');
const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'crm_fanpage.db');
const db = new Database(dbPath);

function parseKarmaNum(val) {
  if (!val) return 0;
  let str = String(val).trim().replace(/,/g, '');
  if (!str || str === '-') return 0;
  let mult = 1;
  if (str.toLowerCase().endsWith('k')) {
    mult = 1000;
    str = str.slice(0, -1);
  } else if (str.toLowerCase().endsWith('m')) {
    mult = 1000000;
    str = str.slice(0, -1);
  } else if (str.endsWith('%')) {
    str = str.slice(0, -1);
  }
  const num = parseFloat(str);
  return isNaN(num) ? 0 : Math.round(num * mult);
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
}

function sendWsMsg(ws, method, params = {}) {
  return new Promise((resolve) => {
    const id = Math.floor(Math.random() * 1000000);
    const handler = (data) => {
      const msg = JSON.parse(data);
      if (msg.id === id) {
        ws.removeListener('message', handler);
        resolve(msg);
      }
    };
    ws.on('message', handler);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function main() {
  const tabs = await getJson('http://127.0.0.1:9222/json/list');
  const karmaTab = tabs.find(t => t.url.includes('fanpagekarma') && t.type === 'page');
  if (!karmaTab) {
    console.error('❌ No active Fanpage Karma tab found in Chrome!');
    process.exit(1);
  }

  const wsUrl = karmaTab.webSocketDebuggerUrl;
  const ws = new WebSocket(wsUrl);

  await new Promise((resolve) => ws.on('open', resolve));
  console.log('✅ Connected to Chrome CDP via WebSocket!');

  const targetUrl = 'https://app.fanpagekarma.com/dashboard?h=Sf6fNa9Vm&tl0=ag5zfmZhbnBhZ2VrYXJtYXIcCxIPRGFzaGJvYXJkUmVwb3J0GICAwZrnkL8LDA&time=FREE&from=1785542400000&to=1787356799999';
  console.log('🚀 Navigating to Content Report URL:', targetUrl);

  await sendWsMsg(ws, 'Page.navigate', { url: targetUrl });
  await new Promise(r => setTimeout(r, 6000));

  let rawPosts = [];

  for (let s = 1; s <= 15; s++) {
    await sendWsMsg(ws, 'Runtime.evaluate', { expression: `
      (function() {
        let allHeaders = Array.from(document.querySelectorAll("*")).filter(el => el.innerText && el.innerText.trim() === "Top 100 Posts Overview");
        let container = null;
        for (let h of allHeaders) {
          let c = h.closest("div.dashboardsDashboard-chart, div.js-dashboard-chartContainer, div[class*='chart']") || h.parentElement.parentElement;
          if (c.querySelectorAll("tr").length >= 10) { container = c; break; }
        }
        if (container) {
          let tableBox = container.querySelector("div[class*='scroll'], div[class*='table'], table") || container;
          tableBox.scrollTop = tableBox.scrollHeight;
        }
        window.scrollTo(0, 2000 + ${s * 300});
      })()
    ` });
    await new Promise(r => setTimeout(r, 1200));

    const jsExtract = `
    JSON.stringify((function() {
      let allHeaders = Array.from(document.querySelectorAll("*")).filter(el => el.innerText && el.innerText.trim() === "Top 100 Posts Overview");
      let targetContainer = null;
      for (let h of allHeaders) {
        let c = h.closest("div.dashboardsDashboard-chart, div.js-dashboard-chartContainer, div[class*='chart'], div.card") || h.parentElement.parentElement;
        if (c.querySelectorAll("tr").length >= 10) { targetContainer = c; break; }
      }
      if (!targetContainer) targetContainer = document;

      let rows = Array.from(targetContainer.querySelectorAll("tbody tr, tr.dashboardPostTabelle_row, tr.dashboardTabelle_row")).filter(r => {
        return r.querySelector("a[href*='facebook.com'], a[href*='instagram.com'], a[href*='reel'], a[href*='posts']") !== null;
      });

      let extracted = [];
      let seenHrefs = new Set();

      for (let r of rows) {
        let cells = Array.from(r.querySelectorAll("td, th")).map(c => c.innerText.replace(/\\n/g, " ").trim());
        let linkEl = r.querySelector("a[href*='facebook.com'], a[href*='instagram.com'], a[href*='posts'], a[href*='reel'], a[href*='permalink']");
        
        // Exact post media thumbnail image (dashboardsPostsTabelle-postPicture) vs page profile picture
        let postImgEl = r.querySelector("img.dashboardsPostsTabelle-postPicture") || r.querySelector("img[class*='postPicture']");
        if (!postImgEl) {
          let imgs = Array.from(r.querySelectorAll("img"));
          postImgEl = imgs.find(i => !i.className.includes("pagePicture")) || imgs[imgs.length - 1];
        }

        let pageNameEl = r.querySelector(".dashboardsPostsTabelle-profileName, a[href*='discovery'], span[class*='profile']");
        let dateEl = r.querySelector(".dashboardsPostsTabelle-postDate, span[class*='date']");
        
        let href = linkEl ? linkEl.href : "";
        if (href && seenHrefs.has(href)) continue;
        if (href) seenHrefs.add(href);

        let caption = linkEl ? linkEl.innerText.trim() : "";
        let postThumbnailSrc = postImgEl ? postImgEl.src : "";
        let pageName = pageNameEl ? pageNameEl.innerText.trim() : "";

        if (!pageName && cells.length > 0) {
          let firstTxt = cells[0];
          let m = firstTxt.match(/^[0-9]+\\s+([A-Za-z0-9\\s&'-]+?)\\s+[0-9]{1,2}\\/[0-9]{1,2}\\/[0-9]{2}/);
          if (m) pageName = m[1].trim();
        }

        let dateTxt = dateEl ? dateEl.innerText.trim() : "";
        if (!dateTxt && cells.length > 0) {
          let mDate = cells[0].match(/([0-9]{1,2}\\/[0-9]{1,2}\\/[0-9]{2},?\\s+[0-9]{1,2}:[0-9]{2}\\s*(?:AM|PM)?)/i);
          if (mDate) dateTxt = mDate[1].trim();
        }

        extracted.push({
          cells: cells,
          post_url: href,
          message: caption,
          thumbnail_url: postThumbnailSrc,
          page_name: pageName,
          published_at_raw: dateTxt,
          likes_raw: cells.length > 1 ? cells[1] : '0',
          comments_raw: cells.length > 2 ? cells[2] : '0',
          interactions_raw: cells.length > 3 ? cells[3] : '0',
          er_raw: cells.length > 4 ? cells[4] : '0',
          reach_raw: cells.length > 5 ? cells[5] : '0',
          ipi_raw: cells.length > 6 ? cells[6] : '0',
          negative_sentiment_raw: cells.length > 7 ? cells[7] : '0'
        });
      }
      return extracted;
    })())
    `;

    const evalRes = await sendWsMsg(ws, 'Runtime.evaluate', { expression: jsExtract, returnByValue: true });
    rawPosts = JSON.parse(evalRes.result.result.value || '[]');
    if (rawPosts.length >= 100) break;
  }

  console.log(`🎯 Extracted EXACTLY ${rawPosts.length} post rows with REAL POST THUMBNAILS!`);

  const allPages = db.prepare('SELECT name, staff_name FROM pages UNION SELECT page_name as name, staff_name FROM master_pages').all();
  const staffMap = new Map();
  for (const p of allPages) {
    if (p.name && p.staff_name) staffMap.set(p.name.trim().toLowerCase(), p.staff_name);
  }

  const postsToInsert = [];

  for (let i = 0; i < rawPosts.length; i++) {
    const r = rawPosts[i];
    const likes = parseKarmaNum(r.likes_raw);
    const comments = parseKarmaNum(r.comments_raw);
    const interactions = parseKarmaNum(r.interactions_raw) || (likes + comments);
    const er = parseKarmaNum(r.er_raw);
    const reach = parseKarmaNum(r.reach_raw);
    const ipi = parseKarmaNum(r.ipi_raw);
    const negSentiment = parseKarmaNum(r.negative_sentiment_raw);

    let postId = '';
    if (r.post_url) {
      const matchId = r.post_url.match(/(?:reel|posts|p)\/([0-9]+)/);
      if (matchId) postId = matchId[1];
    }

    let cleanPageName = (r.page_name || 'Fanpage Karma Viral').split('\n')[0].trim();
    cleanPageName = cleanPageName.replace(/\s+[0-9]{1,2}\/[0-9]{1,2}\/[0-9]{2}.*$/, '').trim();

    let matchedStaff = 'Chưa phân bổ';
    if (staffMap.has(cleanPageName.toLowerCase())) {
      matchedStaff = staffMap.get(cleanPageName.toLowerCase());
    } else {
      for (const [pName, sName] of staffMap.entries()) {
        if (cleanPageName.toLowerCase().includes(pName) || pName.includes(cleanPageName.toLowerCase())) {
          matchedStaff = sName;
          break;
        }
      }
    }

    let publishedAt = new Date().toISOString().replace('T', ' ').substring(0, 19);
    if (r.published_at_raw) {
      try {
        const d = new Date(r.published_at_raw);
        if (!isNaN(d.getTime())) {
          publishedAt = d.toISOString().replace('T', ' ').substring(0, 19);
        }
      } catch(e) {}
    }

    postsToInsert.push({
      page_name: cleanPageName,
      post_id: postId,
      post_url: r.post_url,
      message: r.message || 'Bài viết viral trong Top 100 Posts Overview',
      thumbnail_url: r.thumbnail_url || '',
      media_type: r.post_url.includes('/reel/') ? 'reel' : 'post',
      published_at: publishedAt,
      likes: likes,
      comments: comments,
      shares: 0,
      interactions: interactions,
      interaction_rate: er,
      reach: reach,
      interactions_per_impression: ipi,
      negative_sentiment_share: negSentiment,
      staff_name: matchedStaff,
      source: 'Top 100 Reach Per Post'
    });
  }

  // Sort strictly by Reach Per Post descending
  postsToInsert.sort((a, b) => b.reach - a.reach);
  const top100Reach = postsToInsert.slice(0, 100);

  console.log(`🔥 Selected Top ${top100Reach.length} videos with HIGHEST REACH PER POST and EXACT POST THUMBNAILS!`);

  // Clear existing posts table and insert fresh Top 100 Reach posts
  db.prepare('DELETE FROM posts').run();

  const insertStmt = db.prepare(`
    INSERT INTO posts 
    (page_name, post_id, post_url, message, thumbnail_url, media_type, published_at, likes, comments, shares, interactions, interaction_rate, reach, interactions_per_impression, negative_sentiment_share, staff_name, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let countSqlite = 0;
  const insertMany = db.transaction((rows) => {
    for (const item of rows) {
      insertStmt.run(
        item.page_name,
        item.post_id,
        item.post_url,
        item.message,
        item.thumbnail_url,
        item.media_type,
        item.published_at,
        item.likes,
        item.comments,
        item.shares,
        item.interactions,
        item.interaction_rate,
        item.reach,
        item.interactions_per_impression,
        item.negative_sentiment_share,
        item.staff_name,
        item.source
      );
      countSqlite++;
    }
  });

  insertMany(top100Reach);
  console.log(`✅ Successfully inserted ${countSqlite} posts with EXACT POST THUMBNAILS into Local CRM SQLite!`);

  ws.close();
  console.log('\n🎉 Complete! Top 100 Posts Overview updated on CRM!');
}

main().catch(err => console.error('Error in main script:', err));
