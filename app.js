// ----- Глобальные состояния -----
let socket = null;
let currentToken = localStorage.getItem('token');
let currentUsername = localStorage.getItem('username');
let currentUserId = localStorage.getItem('userId') ? parseInt(localStorage.getItem('userId')) : null;
let activeChatId = null;
let isRegisterMode = false;
let currentUserInfo = null;
let chatUnreadCounts = {};

// DOM элементы
const authBlock = document.getElementById('auth-block');
const appBlock = document.getElementById('app-block');
const authUsername = document.getElementById('auth-username');
const authPassword = document.getElementById('auth-password');
const authEmail = document.getElementById('auth-email');
const emailGroup = document.getElementById('email-group');
const loginBtn = document.getElementById('login-btn');
const registerBtn = document.getElementById('register-btn');
const toggleBtn = document.getElementById('toggle-btn');
const toggleText = document.getElementById('toggle-text');
const authError = document.getElementById('auth-error');
const logoutBtn = document.getElementById('logout-btn');
const chatList = document.getElementById('chat-list');
const msgContainer = document.getElementById('msg-container');
const msgInput = document.getElementById('msg-input');
const sendBtn = document.getElementById('send-btn');
const fileInput = document.getElementById('file-input');
const attachBtn = document.getElementById('attach-btn');
const micBtn = document.getElementById('mic-btn');
const chatName = document.getElementById('chat-name');
const userDisplayName = document.getElementById('user-displayname');
const userAvatar = document.getElementById('user-avatar');
const avatarInput = document.getElementById('avatar-input');
const searchInput = document.getElementById('search-input');
const searchResults = document.getElementById('search-results');
const createGroupBtn = document.getElementById('create-group-btn');
const modalOverlay = document.getElementById('modal-overlay');
const modalTitle = document.getElementById('modal-title');
const modalGroupName = document.getElementById('modal-group-name');
const modalUserSearch = document.getElementById('modal-user-search');
const modalSearchResults = document.getElementById('modal-search-results');
const modalSelectedList = document.getElementById('selected-list');
const selectedCount = document.getElementById('selected-count');
const modalSubmitBtn = document.getElementById('modal-submit-btn');
const modalCloseBtn = document.getElementById('modal-close-btn');
const chatActions = document.getElementById('chat-actions');
const addUserBtn = document.getElementById('add-user-btn');
const removeUserBtn = document.getElementById('remove-user-btn');

// ----- Вспомогательные -----
function showError(msg) { authError.textContent = msg; }
function clearError() { authError.textContent = ''; }
function showAppBlock() {
    authBlock.style.display = 'none';
    appBlock.style.display = 'flex';
}
function showAuthBlock() {
    authBlock.style.display = 'flex';
    appBlock.style.display = 'none';
}

// ----- Авторизация -----
async function login() {
    const username = authUsername.value.trim();
    const password = authPassword.value.trim();
    if (!username || !password) { showError('Заполните все поля'); return; }
    clearError();
    try {
        const formData = new URLSearchParams();
        formData.append('username', username);
        formData.append('password', password);
        const res = await fetch('/api/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: formData
        });
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.detail || 'Ошибка входа');
        }
        const data = await res.json();
        currentToken = data.access_token;
        currentUsername = username;
        currentUserId = data.user_id;
        localStorage.setItem('token', currentToken);
        localStorage.setItem('username', currentUsername);
        localStorage.setItem('userId', currentUserId);
        showAppBlock();
        initApp();
    } catch (e) {
        showError(e.message);
    }
}

async function register() {
    const username = authUsername.value.trim();
    const password = authPassword.value.trim();
    const email = authEmail.value.trim();
    if (!username || !password || !email) { showError('Заполните все поля'); return; }
    clearError();
    try {
        const res = await fetch('/api/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password, email })
        });
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.detail || 'Ошибка регистрации');
        }
        const data = await res.json();
        currentToken = data.access_token;
        currentUsername = username;
        currentUserId = data.user_id;
        localStorage.setItem('token', currentToken);
        localStorage.setItem('username', currentUsername);
        localStorage.setItem('userId', currentUserId);
        showAppBlock();
        initApp();
    } catch (e) {
        showError(e.message);
    }
}

function toggleAuthMode() {
    isRegisterMode = !isRegisterMode;
    if (isRegisterMode) {
        emailGroup.style.display = 'block';
        loginBtn.style.display = 'none';
        registerBtn.style.display = 'block';
        toggleText.textContent = 'Уже есть аккаунт?';
        toggleBtn.textContent = 'Войти';
    } else {
        emailGroup.style.display = 'none';
        loginBtn.style.display = 'block';
        registerBtn.style.display = 'none';
        toggleText.textContent = 'Нет аккаунта?';
        toggleBtn.textContent = 'Зарегистрироваться';
    }
    clearError();
}

function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('username');
    localStorage.removeItem('userId');
    if (socket) socket.close();
    socket = null;
    currentToken = null;
    currentUsername = null;
    currentUserId = null;
    activeChatId = null;
    chatUnreadCounts = {};
    showAuthBlock();
}

// ----- Аватарка -----
userAvatar.addEventListener('click', () => avatarInput.click());
avatarInput.addEventListener('change', async function() {
    if (!this.files.length) return;
    const file = this.files[0];
    if (!file.type.startsWith('image/')) {
        alert('Пожалуйста, выберите изображение');
        this.value = '';
        return;
    }
    const formData = new FormData();
    formData.append('file', file);
    try {
        const res = await fetch('/api/upload_avatar', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${currentToken}` },
            body: formData
        });
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.detail || 'Ошибка загрузки аватарки');
        }
        const data = await res.json();
        userAvatar.src = data.avatar_path;
        if (currentUserInfo) {
            currentUserInfo.avatar_path = data.avatar_path;
        }
        loadChats();
    } catch (e) {
        console.error(e);
        alert('Не удалось загрузить аватарку: ' + e.message);
    }
    this.value = '';
});

// ----- Информация о себе -----
async function loadUserInfo() {
    try {
        const res = await fetch('/api/users/me', {
            headers: { 'Authorization': `Bearer ${currentToken}` }
        });
        if (!res.ok) throw new Error('Не удалось получить данные пользователя');
        const user = await res.json();
        currentUserInfo = user;
        userDisplayName.textContent = user.display_name || user.username;
        userAvatar.src = user.avatar_path + '?t=' + Date.now();
    } catch (e) {
        console.error(e);
    }
}

// ----- Чаты -----
async function loadChats() {
    try {
        const res = await fetch('/api/chats', {
            headers: { 'Authorization': `Bearer ${currentToken}` }
        });
        if (!res.ok) throw new Error('Не удалось загрузить чаты');
        const chats = await res.json();
        chats.forEach(chat => {
            chatUnreadCounts[chat.id] = chat.unread_count || 0;
        });
        renderChatList(chats);
        if (chats.length > 0 && !activeChatId) {
            selectChat(chats[0].id);
        } else if (chats.length === 0) {
            showEmptyChat();
        } else if (activeChatId) {
            const exists = chats.some(c => c.id === activeChatId);
            if (!exists) {
                activeChatId = null;
                showEmptyChat();
                if (chats.length > 0) selectChat(chats[0].id);
            }
        }
    } catch (e) {
        console.error(e);
    }
}

function renderChatList(chats) {
    chatList.innerHTML = '';
    chats.forEach(chat => {
        const div = document.createElement('div');
        div.className = 'chat-item' + (chat.id === activeChatId ? ' active' : '');
        div.dataset.chatId = chat.id;
        div.dataset.isGroup = chat.is_group;
        div.dataset.isCreator = chat.is_creator;

        const avatar = document.createElement('div');
        avatar.className = 'avatar';
        avatar.textContent = chat.name.charAt(0).toUpperCase();

        const info = document.createElement('div');
        info.className = 'info';
        const nameSpan = document.createElement('div');
        nameSpan.className = 'name';
        nameSpan.textContent = chat.name;
        const lastSpan = document.createElement('div');
        lastSpan.className = 'last-msg';
        lastSpan.textContent = chat.last_message || 'Нет сообщений';
        info.appendChild(nameSpan);
        info.appendChild(lastSpan);

        const timeSpan = document.createElement('div');
        timeSpan.className = 'time';
        if (chat.last_message_time) {
            const d = new Date(chat.last_message_time);
            timeSpan.textContent = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }

        const unread = chatUnreadCounts[chat.id] || 0;
        if (unread > 0) {
            const badge = document.createElement('span');
            badge.className = 'unread-badge';
            badge.textContent = unread > 99 ? '99+' : unread;
            div.appendChild(badge);
        }

        div.appendChild(avatar);
        div.appendChild(info);
        div.appendChild(timeSpan);
        div.addEventListener('click', () => selectChat(chat.id));
        chatList.appendChild(div);
    });
}

// ----- Выбор чата -----
async function selectChat(chatId) {
    if (chatId === activeChatId) return;
    activeChatId = chatId;
    try {
        await fetch(`/api/chats/${chatId}/read`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${currentToken}` }
        });
        chatUnreadCounts[chatId] = 0;
        loadChats();
    } catch (e) {
        console.error('Ошибка отметки прочитанных', e);
    }
    document.querySelectorAll('.chat-item').forEach(el => {
        el.classList.toggle('active', parseInt(el.dataset.chatId) === chatId);
    });
    await loadMessages(chatId);
    const chatNameEl = document.querySelector(`.chat-item[data-chat-id="${chatId}"] .name`);
    chatName.textContent = chatNameEl ? chatNameEl.textContent : 'Чат';
    msgInput.disabled = false;
    sendBtn.disabled = false;
    const chatItem = document.querySelector(`.chat-item[data-chat-id="${chatId}"]`);
    const isGroup = chatItem ? chatItem.dataset.isGroup === 'true' : false;
    const isCreator = chatItem ? chatItem.dataset.isCreator === 'true' : false;
    if (isGroup && isCreator) {
        chatActions.style.display = 'flex';
        removeUserBtn.style.display = 'inline-block';
        addUserBtn.style.display = 'inline-block';
    } else {
        chatActions.style.display = 'none';
    }
    if (isGroup && isCreator) {
        await loadChatMembers(chatId);
    }
    initSocket();
}

let currentChatMembers = [];
async function loadChatMembers(chatId) {
    try {
        const res = await fetch(`/api/chats/${chatId}/info`, {
            headers: { 'Authorization': `Bearer ${currentToken}` }
        });
        if (!res.ok) throw new Error('Не удалось загрузить информацию о чате');
        const info = await res.json();
        currentChatMembers = info.members.filter(m => m.id !== currentUserId);
    } catch (e) {
        console.error(e);
    }
}

function showEmptyChat() {
    chatName.textContent = 'Выберите кому написать';
    msgContainer.innerHTML = '<div class="empty-chat">Выберите кому написать</div>';
    msgInput.disabled = true;
    sendBtn.disabled = true;
    chatActions.style.display = 'none';
}

// ----- Сообщения -----
async function loadMessages(chatId) {
    try {
        const res = await fetch(`/api/messages/${chatId}`, {
            headers: { 'Authorization': `Bearer ${currentToken}` }
        });
        if (!res.ok) throw new Error('Ошибка загрузки сообщений');
        const messages = await res.json();
        msgContainer.innerHTML = '';
        if (messages.length === 0) {
            msgContainer.innerHTML = '<div class="empty-chat">Нет сообщений</div>';
        } else {
            messages.forEach(msg => appendMessageToContainer(msg, false));
        }
        msgContainer.scrollTop = msgContainer.scrollHeight;
    } catch (e) {
        console.error(e);
    }
}

function sendTextMessage() {
    const text = msgInput.value.trim();
    if (!text || !activeChatId || !socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({
        type: 'text_message',
        chat_id: activeChatId,
        text_content: text
    }));
    msgInput.value = '';
}

function appendMessageToContainer(data, scroll = true) {
    const row = document.createElement('div');
    row.className = `msg-row ${data.sender_username === currentUsername ? 'sent' : 'received'}`;
    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble';
    if (data.message_type === 'image') {
        const img = document.createElement('img');
        img.src = data.file_path;
        img.alt = 'Изображение';
        bubble.appendChild(img);
    } else if (data.message_type === 'audio') {
        const audio = document.createElement('audio');
        audio.controls = true;
        audio.src = data.file_path;
        bubble.appendChild(audio);
    } else {
        bubble.textContent = data.text_content || '';
    }
    row.appendChild(bubble);
    msgContainer.appendChild(row);
    if (scroll) msgContainer.scrollTop = msgContainer.scrollHeight;
}

async function uploadFile(file) {
    if (!activeChatId) return;
    const formData = new FormData();
    formData.append('file', file);
    formData.append('chat_id', activeChatId);
    try {
        const res = await fetch('/api/upload', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${currentToken}` },
            body: formData
        });
        if (!res.ok) throw new Error('Ошибка загрузки');
    } catch (e) {
        console.error(e);
    }
}

// ----- Голосовая запись -----
let mediaRecorder = null;
let audioChunks = [];
async function toggleVoiceRecord() {
    if (!activeChatId) return;
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
        micBtn.style.color = '#b0b2c7';
        return;
    }
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream);
        audioChunks = [];
        mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
        mediaRecorder.onstop = async () => {
            const blob = new Blob(audioChunks, { type: 'audio/wav' });
            const file = new File([blob], 'voice.wav', { type: 'audio/wav' });
            await uploadFile(file);
            micBtn.style.color = '#b0b2c7';
        };
        mediaRecorder.start();
        micBtn.style.color = '#ff6b6b';
    } catch (e) {
        console.error('Нет доступа к микрофону', e);
    }
}

// ----- Поиск пользователей -----
let searchTimeout = null;
searchInput.addEventListener('input', function() {
    clearTimeout(searchTimeout);
    const q = this.value.trim();
    if (q.length === 0) {
        searchResults.style.display = 'none';
        return;
    }
    searchTimeout = setTimeout(async () => {
        try {
            const res = await fetch(`/api/users/search?q=${encodeURIComponent(q)}&exclude_self=true`, {
                headers: { 'Authorization': `Bearer ${currentToken}` }
            });
            if (!res.ok) throw new Error('Ошибка поиска');
            const users = await res.json();
            if (users.length === 0) {
                searchResults.innerHTML = '<div class="result-item">Ничего не найдено</div>';
            } else {
                searchResults.innerHTML = users.map(u => `
                    <div class="result-item" data-user-id="${u.id}">
                        <img src="${u.avatar_path || '/static/default_avatar.png'}" class="avatar-small" style="width:30px;height:30px;border-radius:50%;">
                        <span class="name">${u.display_name || u.username}</span>
                        <span class="username">@${u.username}</span>
                    </div>
                `).join('');
                document.querySelectorAll('.search-results .result-item').forEach(el => {
                    el.addEventListener('click', function() {
                        const userId = parseInt(this.dataset.userId);
                        startDirectChat(userId);
                        searchResults.style.display = 'none';
                        searchInput.value = '';
                    });
                });
            }
            searchResults.style.display = 'block';
        } catch (e) {
            console.error(e);
        }
    }, 300);
});
document.addEventListener('click', function(e) {
    if (!e.target.closest('.sidebar-search')) {
        searchResults.style.display = 'none';
    }
});

async function startDirectChat(userId) {
    try {
        const res = await fetch(`/api/chats/direct/${userId}`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${currentToken}` }
        });
        if (!res.ok) throw new Error('Не удалось создать чат');
        const data = await res.json();
        await loadChats();
        selectChat(data.chat_id);
    } catch (e) {
        console.error(e);
        alert('Ошибка: ' + e.message);
    }
}

// ----- СОЗДАНИЕ ГРУППЫ (с автоматическим добавлением создателя и отображением имён) -----
// Храним выбранных пользователей как массив объектов { id, name }
let selectedUsersForGroup = [];

createGroupBtn.addEventListener('click', function() {
    modalTitle.textContent = 'Создать группу';
    modalSubmitBtn.textContent = 'Создать';
    modalGroupName.value = '';
    // Добавляем текущего пользователя с его именем
    selectedUsersForGroup = [{ id: currentUserId, name: currentUserInfo?.display_name || currentUsername || 'Вы' }];
    updateSelectedUsersUI();
    modalUserSearch.value = '';
    modalSearchResults.innerHTML = '';
    modalGroupName.style.display = 'block';
    modalOverlay.style.display = 'flex';
    modalSubmitBtn.onclick = createGroupSubmit;
});

modalCloseBtn.addEventListener('click', function() {
    modalOverlay.style.display = 'none';
    modalGroupName.style.display = 'block';
    modalSubmitBtn.onclick = createGroupSubmit;
});
modalOverlay.addEventListener('click', function(e) {
    if (e.target === this) {
        modalOverlay.style.display = 'none';
        modalGroupName.style.display = 'block';
        modalSubmitBtn.onclick = createGroupSubmit;
    }
});

modalUserSearch.addEventListener('input', function() {
    const q = this.value.trim();
    if (q.length === 0) {
        modalSearchResults.innerHTML = '';
        return;
    }
    fetch(`/api/users/search?q=${encodeURIComponent(q)}&exclude_self=false`, {
        headers: { 'Authorization': `Bearer ${currentToken}` }
    })
    .then(res => res.json())
    .then(users => {
        if (users.length === 0) {
            modalSearchResults.innerHTML = '<div class="result-item">Ничего не найдено</div>';
        } else {
            modalSearchResults.innerHTML = users.map(u => `
                <div class="result-item" data-user-id="${u.id}" data-user-name="${u.display_name || u.username}">
                    <img src="${u.avatar_path || '/static/default_avatar.png'}" class="avatar-small" style="width:30px;height:30px;border-radius:50%;">
                    <span class="name">${u.display_name || u.username}</span>
                    <span class="username">@${u.username}</span>
                    ${u.id === currentUserId ? ' <span style="color:#7b2ffc;font-size:12px;">(Вы)</span>' : ''}
                </div>
            `).join('');
            document.querySelectorAll('#modal-search-results .result-item').forEach(el => {
                el.addEventListener('click', function() {
                    const userId = parseInt(this.dataset.userId);
                    const userName = this.dataset.userName;
                    if (userId === currentUserId) {
                        alert('Вы уже в списке');
                        return;
                    }
                    if (!selectedUsersForGroup.some(u => u.id === userId)) {
                        selectedUsersForGroup.push({ id: userId, name: userName });
                        updateSelectedUsersUI();
                    }
                    modalUserSearch.value = '';
                    modalSearchResults.innerHTML = '';
                });
            });
        }
    })
    .catch(console.error);
});

function updateSelectedUsersUI() {
    selectedCount.textContent = selectedUsersForGroup.length;
    modalSelectedList.innerHTML = selectedUsersForGroup.map(u => {
        const isSelf = (u.id === currentUserId);
        return `
            <span class="chip">
                ${isSelf ? 'Вы' : u.name}
                ${!isSelf ? `<span class="remove" data-user-id="${u.id}">&times;</span>` : ''}
            </span>
        `;
    }).join('');
    document.querySelectorAll('.chip .remove').forEach(el => {
        el.addEventListener('click', function() {
            const userId = parseInt(this.dataset.userId);
            if (userId === currentUserId) return;
            selectedUsersForGroup = selectedUsersForGroup.filter(u => u.id !== userId);
            updateSelectedUsersUI();
        });
    });
}

async function createGroupSubmit() {
    const name = modalGroupName.value.trim();
    if (!name) {
        alert('Введите название группы');
        return;
    }
    // Убедимся, что текущий пользователь в списке
    if (!selectedUsersForGroup.some(u => u.id === currentUserId)) {
        selectedUsersForGroup.push({ id: currentUserId, name: currentUserInfo?.display_name || currentUsername || 'Вы' });
        updateSelectedUsersUI();
    }
    if (selectedUsersForGroup.length < 2) {
        alert('Выберите минимум 2 участника (включая вас)');
        return;
    }
    const userIds = selectedUsersForGroup.map(u => u.id);
    try {
        const res = await fetch('/api/chats/group', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${currentToken}`
            },
            body: JSON.stringify({
                name: name,
                user_ids: userIds
            })
        });
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.detail || 'Ошибка создания группы');
        }
        const data = await res.json();
        modalOverlay.style.display = 'none';
        await loadChats();
        selectChat(data.chat_id);
    } catch (e) {
        alert('Ошибка: ' + e.message);
    }
}

// ----- Удаление участников -----
removeUserBtn.addEventListener('click', function() {
    if (!activeChatId) return;
    if (currentChatMembers.length === 0) {
        alert('Нет участников для удаления');
        return;
    }
    const options = currentChatMembers.map((m, idx) => `${idx+1}. ${m.display_name || m.username}`).join('\n');
    const choice = prompt(`Выберите номер участника для удаления:\n${options}`);
    if (choice === null) return;
    const idx = parseInt(choice) - 1;
    if (isNaN(idx) || idx < 0 || idx >= currentChatMembers.length) {
        alert('Неверный выбор');
        return;
    }
    const userToRemove = currentChatMembers[idx];
    removeMemberFromChat(userToRemove.id);
});

async function removeMemberFromChat(userId) {
    try {
        const res = await fetch(`/api/chats/${activeChatId}/remove/${userId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${currentToken}` }
        });
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.detail || 'Ошибка удаления');
        }
        alert('Участник удалён');
        await loadChats();
        await loadChatMembers(activeChatId);
    } catch (e) {
        alert('Ошибка: ' + e.message);
    }
}

// ----- Добавление участников (с отображением имён) -----
addUserBtn.addEventListener('click', function() {
    if (!activeChatId) return;
    modalTitle.textContent = 'Добавить участника';
    modalSubmitBtn.textContent = 'Добавить';
    modalGroupName.style.display = 'none';
    selectedUsersForGroup = []; // очищаем, будем выбирать одного
    updateSelectedUsersUI();
    modalUserSearch.value = '';
    modalSearchResults.innerHTML = '';
    modalOverlay.style.display = 'flex';
    modalSubmitBtn.onclick = async function() {
        if (selectedUsersForGroup.length === 0) {
            alert('Выберите пользователя');
            return;
        }
        const userId = selectedUsersForGroup[0].id;
        try {
            const res = await fetch(`/api/chats/${activeChatId}/add`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${currentToken}`
                },
                body: JSON.stringify({ user_id: userId })
            });
            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.detail || 'Ошибка добавления');
            }
            alert('Пользователь добавлен');
            modalOverlay.style.display = 'none';
            await loadChats();
            await loadChatMembers(activeChatId);
            modalGroupName.style.display = 'block';
            modalSubmitBtn.onclick = createGroupSubmit;
        } catch (e) {
            alert('Ошибка: ' + e.message);
        }
    };
});

// ----- WebSocket -----
function initSocket() {
    if (!currentToken) return;
    if (socket && socket.readyState === WebSocket.OPEN) return;
    if (socket) socket.close();
    socket = new WebSocket(`ws://${window.location.host}/ws?token=${currentToken}`);
    socket.onopen = () => console.log('WebSocket подключён');
    socket.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.chat_id === activeChatId) {
            appendMessageToContainer(data);
        } else {
            if (chatUnreadCounts[data.chat_id] !== undefined) {
                chatUnreadCounts[data.chat_id] = (chatUnreadCounts[data.chat_id] || 0) + 1;
            } else {
                chatUnreadCounts[data.chat_id] = 1;
            }
        }
        loadChats();
    };
    socket.onclose = () => {
        console.log('WebSocket закрыт, переподключение...');
        setTimeout(initSocket, 3000);
    };
    socket.onerror = (err) => console.error('WebSocket ошибка', err);
}

// ----- Инициализация приложения -----
async function initApp() {
    await loadUserInfo();
    await loadChats();
    initSocket();

    sendBtn.onclick = sendTextMessage;
    msgInput.onkeypress = (e) => {
        if (e.key === 'Enter') sendTextMessage();
    };
    attachBtn.onclick = () => fileInput.click();
    fileInput.onchange = () => {
        if (fileInput.files.length) {
            uploadFile(fileInput.files[0]);
            fileInput.value = '';
        }
    };
    micBtn.onclick = toggleVoiceRecord;
    logoutBtn.onclick = logout;
}

// ----- Обработчики авторизации -----
loginBtn.onclick = login;
registerBtn.onclick = register;
toggleBtn.onclick = toggleAuthMode;
authUsername.onkeypress = authPassword.onkeypress = (e) => {
    if (e.key === 'Enter') {
        if (isRegisterMode) register();
        else login();
    }
};

// ----- Старт -----
window.onload = function() {
    if (currentToken && currentUsername && currentUserId) {
        showAppBlock();
        initApp();
    } else {
        showAuthBlock();
        isRegisterMode = false;
        emailGroup.style.display = 'none';
        loginBtn.style.display = 'block';
        registerBtn.style.display = 'none';
        toggleText.textContent = 'Нет аккаунта?';
        toggleBtn.textContent = 'Зарегистрироваться';
    }
};