
    const draftFieldIds = [
      'in_title', 'in_cert_no', 'in_recipient_name', 'in_nik', 'in_profession',
      'in_course_name', 'in_organizer', 'in_date', 'in_role', 'in_jpl',
      'in_signer_title_1', 'in_signer_title_2', 'in_signer_name', 'in_qr_data'
    ];
    let draftDb = null;
    let draftStorage = null;
    let currentDraftId = null;
    const databaseReady = initializeDraftDatabase();

    function openDraftStorage() {
      return new Promise((resolve, reject) => {
        const request = indexedDB.open('sertifikat-draft-storage', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('database');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }

    function readStoredDatabase() {
      return new Promise((resolve, reject) => {
        const transaction = draftStorage.transaction('database', 'readonly');
        const request = transaction.objectStore('database').get('sqlite');
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
      });
    }

    function persistDatabase() {
      return new Promise((resolve, reject) => {
        const transaction = draftStorage.transaction('database', 'readwrite');
        transaction.objectStore('database').put(draftDb.export(), 'sqlite');
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
    }

    async function initializeDraftDatabase() {
      try {
        const SQL = await initSqlJs({
          locateFile: filename => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.13.0/${filename}`
        });
        draftStorage = await openDraftStorage();
        const storedDatabase = await readStoredDatabase();
        draftDb = storedDatabase ? new SQL.Database(storedDatabase) : new SQL.Database();
        draftDb.run(`CREATE TABLE IF NOT EXISTS drafts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          recipient_name TEXT NOT NULL,
          certificate_number TEXT NOT NULL,
          data_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )`);
        await persistDatabase();
        renderDraftList();
        document.getElementById('saveDraftButton').disabled = false;
        setDraftStatus('SQLite siap. Draft tersimpan di browser ini.');
        return true;
      } catch (error) {
        console.error('Gagal menginisialisasi SQLite:', error);
        const button = document.getElementById('saveDraftButton');
        button.disabled = true;
        setDraftStatus('SQLite tidak tersedia. Periksa koneksi internet atau dukungan penyimpanan browser.', true);
        return false;
      }
    }

    const fields = [
      { input: 'in_title', output: 'out_title' },
      { input: 'in_cert_no', output: 'out_cert_no' },
      { input: 'in_cert_no', output: 'out_curriculum_cert_no' },
      { input: 'in_recipient_name', output: 'out_recipient_name' },
      { input: 'in_recipient_name', output: 'out_curriculum_name' },
      { input: 'in_nik', output: 'out_curriculum_nik' },
      { input: 'in_profession', output: 'out_curriculum_profession' },
      { input: 'in_course_name', output: 'out_course_name' },
      { input: 'in_course_name', output: 'out_curriculum_course' },
      { input: 'in_organizer', output: 'out_organizer' },
      { input: 'in_organizer', output: 'out_curriculum_organizer' },
      { input: 'in_date', output: 'out_date' },
      { input: 'in_role', output: 'out_role' },
      { input: 'in_role', output: 'out_curriculum_role' },
      { input: 'in_jpl', output: 'out_jpl' },
      { input: 'in_signer_title_1', output: 'out_signer_title_1' },
      { input: 'in_signer_title_2', output: 'out_signer_title_2' },
      { input: 'in_signer_name', output: 'out_signer_name' }
    ];

    // Hubungkan setiap input form langsung ke teks di sertifikat
    fields.forEach(field => {
      const elInput = document.getElementById(field.input);
      const elOutput = document.getElementById(field.output);
      
      if (elInput && elOutput) {
        elInput.addEventListener('input', () => {
          elOutput.textContent = elInput.value;
        });
      }
    });

    function updateCurriculumText() {
      const dateValue = document.getElementById('in_date').value.trim().replace(/^Pada\s+/i, '');
      const dateParts = dateValue.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{4})\s*s\/d\s*(\d{1,2})[-/](\d{1,2})[-/](\d{4})/i);
      const months = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
      let formattedDate = dateValue ? `tanggal ${dateValue}` : '';

      if (dateParts) {
        formattedDate = `tanggal ${dateParts[1]} ${months[Number(dateParts[2]) - 1] || dateParts[2]} ${dateParts[3]} s/d ${dateParts[4]} ${months[Number(dateParts[5]) - 1] || dateParts[5]} ${dateParts[6]}`;
      }

      const role = document.getElementById('in_role').value.trim();
      const jpl = document.getElementById('in_jpl').value.trim();
      const jplParts = jpl.match(/(\d+)\s*Jam Pelajaran.*?(\d+)\s*SKP/i);
      const formattedJpl = jplParts
        ? `jumlah ${jplParts[1]} jam pelajaran senilai ${jplParts[2]} Satuan Kredit Profesi (SKP)`
        : jpl.charAt(0).toLowerCase() + jpl.slice(1);

      document.getElementById('out_curriculum_date').textContent = formattedDate;
      document.getElementById('out_curriculum_role').textContent = role.charAt(0).toLowerCase() + role.slice(1);
      document.getElementById('out_curriculum_jpl').textContent = formattedJpl;
    }

    function setDraftStatus(message, isError = false) {
      const status = document.getElementById('draftSaveStatus');
      status.textContent = message;
      status.style.color = isError ? '#b91c1c' : '#0f766e';
    }

    function getDraftFormData() {
      return Object.fromEntries(draftFieldIds.map(id => [id, document.getElementById(id).value]));
    }

    async function saveDraft() {
      if (!await databaseReady || !draftDb) {
        setDraftStatus('SQLite belum siap. Draft belum disimpan.', true);
        return;
      }

      const button = document.getElementById('saveDraftButton');
      button.disabled = true;
      try {
        const data = getDraftFormData();
        const now = new Date().toISOString();
        if (currentDraftId === null) {
          draftDb.run(
            'INSERT INTO drafts (recipient_name, certificate_number, data_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
            [data.in_recipient_name.trim() || 'Tanpa nama', data.in_cert_no.trim(), JSON.stringify(data), now, now]
          );
          currentDraftId = draftDb.exec('SELECT last_insert_rowid()')[0].values[0][0];
        } else {
          draftDb.run(
            'UPDATE drafts SET recipient_name = ?, certificate_number = ?, data_json = ?, updated_at = ? WHERE id = ?',
            [data.in_recipient_name.trim() || 'Tanpa nama', data.in_cert_no.trim(), JSON.stringify(data), now, currentDraftId]
          );
        }
        await persistDatabase();
        renderDraftList();
        setDraftStatus(`Draft tersimpan ${new Date(now).toLocaleString('id-ID')}.`);
      } catch (error) {
        console.error('Gagal menyimpan draft:', error);
        setDraftStatus(`Gagal menyimpan draft: ${error.message}`, true);
      } finally {
        button.disabled = false;
      }
    }

    function renderDraftList() {
      const list = document.getElementById('draftList');
      if (!list || !draftDb) return;

      list.replaceChildren();
      const result = draftDb.exec('SELECT id, recipient_name, certificate_number, updated_at FROM drafts ORDER BY updated_at DESC');
      const rows = result.length ? result[0].values : [];
      document.getElementById('draftCount').textContent = rows.length;
      document.getElementById('draftEmpty').hidden = rows.length > 0;

      rows.forEach(([id, name, certificateNumber, updatedAt]) => {
        const row = document.createElement('tr');
        [name, certificateNumber, new Date(updatedAt).toLocaleString('id-ID')].forEach(value => {
          const cell = document.createElement('td');
          cell.textContent = value || '-';
          row.appendChild(cell);
        });

        const actions = document.createElement('td');
        const actionGroup = document.createElement('div');
        actionGroup.className = 'draft-actions';
        const editButton = document.createElement('button');
        editButton.type = 'button';
        editButton.className = 'px-3 py-1.5 bg-teal-700 text-white hover:bg-teal-800 rounded text-xs font-semibold';
        editButton.textContent = 'Edit';
        editButton.addEventListener('click', () => editDraft(Number(id)));
        const deleteButton = document.createElement('button');
        deleteButton.type = 'button';
        deleteButton.className = 'px-3 py-1.5 border border-slate-300 text-slate-700 hover:bg-slate-100 rounded text-xs font-semibold';
        deleteButton.textContent = 'Hapus';
        deleteButton.addEventListener('click', () => deleteDraft(Number(id)));
        actionGroup.append(editButton, deleteButton);
        actions.appendChild(actionGroup);
        row.appendChild(actions);
        list.appendChild(row);
      });
    }

    async function editDraft(draftId) {
      if (!await databaseReady || !draftDb) return;
      const result = draftDb.exec(`SELECT data_json FROM drafts WHERE id = ${Number(draftId)}`);
      if (!result.length || !result[0].values.length) return;

      const data = JSON.parse(result[0].values[0][0]);
      currentDraftId = Number(draftId);
      draftFieldIds.forEach(id => {
        const input = document.getElementById(id);
        input.value = data[id] ?? '';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      showEditor();
      setDraftStatus(`Mengedit draft: ${data.in_recipient_name || 'Tanpa nama'}`);
    }

    async function deleteDraft(draftId) {
      if (!await databaseReady || !draftDb || !confirm('Hapus draft ini?')) return;
      draftDb.run('DELETE FROM drafts WHERE id = ?', [Number(draftId)]);
      await persistDatabase();
      if (currentDraftId === Number(draftId)) currentDraftId = null;
      renderDraftList();
    }

    async function showDashboard() {
      if (!await databaseReady) return;
      if (currentDraftId !== null) await saveDraft();
      renderDraftList();
      document.body.classList.add('dashboard-active');
    }

    function showEditor() {
      document.body.classList.remove('dashboard-active');
    }

    function createNewDraft() {
      currentDraftId = null;
      resetToDefault();
      showEditor();
      setDraftStatus('Draft baru. Simpan untuk menambahkannya ke daftar.');
    }

    ['in_date', 'in_role', 'in_jpl'].forEach(id => {
      document.getElementById(id).addEventListener('input', updateCurriculumText);
    });
    updateCurriculumText();

    async function createCurriculumCanvas() {
      if (typeof html2canvas !== 'function') {
        throw new Error('Gagal memuat generator PNG. Periksa koneksi internet lalu coba lagi.');
      }

      await document.fonts.ready;
      const sheet = document.getElementById('curriculum_sheet');
      return html2canvas(sheet, {
        backgroundColor: '#ffffff',
        scale: 2,
        useCORS: true
      });
    }

    function getCurriculumFilename() {
      const filename = document.getElementById('in_recipient_name').value.trim()
        .replace(/[^a-z0-9]+/gi, '-')
        .replace(/^-|-$/g, '') || 'peserta';
      return `lampiran-${filename}.png`;
    }

    async function downloadCurriculumImage() {
      try {
        const canvas = await createCurriculumCanvas();
        const link = document.createElement('a');
        link.download = getCurriculumFilename();
        link.href = canvas.toDataURL('image/png');
        link.click();
      } catch (error) {
        alert(`Gagal membuat gambar: ${error.message}`);
      }
    }

    async function uploadAttachmentToMeQr() {
      const button = document.getElementById('uploadAttachmentButton');
      const status = document.getElementById('qrUploadStatus');
      button.disabled = true;
      status.textContent = 'Membuat dan mengunggah lampiran...';
      status.style.color = '#0f766e';

      try {
        const canvas = await createCurriculumCanvas();
        const apiEndpoint = window.location.port === '4173'
          ? '/api/qr/file'
          : 'http://127.0.0.1:4173/api/qr/file';
        const response = await fetch(apiEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fileName: getCurriculumFilename(),
            file: canvas.toDataURL('image/png')
          })
        });
        const result = await response.json();
        if (!response.ok) {
          const errorMessage = [result.error, result.details].filter(Boolean).join(' | ');
          throw new Error(errorMessage || 'ME-QR gagal membuat QR untuk lampiran.');
        }

        qrInput.value = result.url;
        qrImg.src = result.qrImageUrl;
        status.textContent = 'Lampiran diunggah. QR kini membuka lampiran yang dihosting ME-QR.';
      } catch (error) {
        status.textContent = error.message;
        status.style.color = '#b91c1c';
      } finally {
        button.disabled = false;
      }
    }

    // Penanganan pembaruan QR Code dinamis untuk URL yang diedit manual
    const qrInput = document.getElementById('in_qr_data');
    const qrImg = document.getElementById('out_qr_img');
    
    let qrTimer = null;
    qrInput.addEventListener('input', () => {
      clearTimeout(qrTimer);
      qrTimer = setTimeout(() => {
        const encoded = encodeURIComponent(qrInput.value.trim());
        qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=115x115&data=${encoded}`;
      }, 400);
    });

    // Reset formulir kembali ke data default persis gambar
    function resetToDefault() {
      const defaults = {
        in_title: 'Pengembangan Keprofesian Berkelanjutan',
        in_cert_no: 'KT.03.02/F/7413026/SER/2026',
        in_recipient_name: 'BOBI MAHENDRA',
        in_nik: '3215071007030002',
        in_profession: 'Ners',
        in_course_name: 'Pelatihan Basic Trauma Cardiac Life Support (BTCLS)',
        in_organizer: 'MEDS INDONESIA',
        in_date: 'Pada 12-10-2026 s/d 17-10-2026',
        in_role: 'Sebagai Peserta',
        in_jpl: 'Jumlah 55 Jam Pelajaran Senilai 15 SKP',
        in_signer_title_1: 'a.n Menteri Kesehatan',
        in_signer_title_2: 'Direktur Jenderal Sumber Daya Manusia Kesehatan',
        in_signer_name: 'dr. YULI FARIANTI, M.Epid',
        in_qr_data: 'https://kemkes.go.id/verifikasi/KT.03.02/F/7413026/SER/2026'
      };

      for (let id in defaults) {
        const input = document.getElementById(id);
        if (input) {
          input.value = defaults[id];
          input.dispatchEvent(new Event('input'));
        }
      }
    }
  