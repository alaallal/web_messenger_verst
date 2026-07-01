import os
import shutil
from datetime import datetime
from typing import List, Optional
from fastapi import FastAPI, Depends, HTTPException, WebSocket, WebSocketDisconnect, UploadFile, File, Form
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from pydantic import BaseModel
import uvicorn

from database import engine, SessionLocal, Base, User, Chat, ChatMember, Message, MessageRead

# ---------- Инициализация ----------
Base.metadata.create_all(bind=engine)
app = FastAPI(title="Verst Messenger")

app.mount("/static", StaticFiles(directory="static"), name="static")

UPLOAD_DIR = "static/uploads"
AVATAR_DIR = "static/avatars"
os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(AVATAR_DIR, exist_ok=True)

# ---------- База данных ----------
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# ---------- Авторизация ----------
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/token")

def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    if not token.startswith("jwt-token-for-"):
        raise HTTPException(status_code=401, detail="Неверный токен")
    username = token.replace("jwt-token-for-", "")
    user = db.query(User).filter(User.username == username).first()
    if not user:
        raise HTTPException(status_code=401, detail="Пользователь не найден")
    return user

# ---------- Pydantic-схемы ----------
class UserCreate(BaseModel):
    username: str
    password: str
    email: str
    display_name: Optional[str] = None

class Token(BaseModel):
    access_token: str
    token_type: str
    user_id: int

class UserOut(BaseModel):
    id: int
    username: str
    display_name: str
    avatar_path: str
    status: str

class ChatOut(BaseModel):
    id: int
    name: Optional[str]
    is_group: bool
    is_creator: bool
    last_message: Optional[str] = None
    last_message_time: Optional[datetime] = None
    unread_count: int = 0

class MessageOut(BaseModel):
    id: int
    sender_id: int
    sender_username: str
    text_content: Optional[str]
    message_type: str
    file_path: Optional[str]
    created_at: datetime
    is_read: bool = False

class CreateGroupChat(BaseModel):
    name: str
    user_ids: List[int]

class AddUserToChat(BaseModel):
    user_id: int

# ---------- Вспомогательные функции ----------
def mark_messages_as_read(db: Session, chat_id: int, user_id: int):
    subquery = db.query(MessageRead.message_id).filter(MessageRead.user_id == user_id).subquery()
    messages = db.query(Message).filter(
        Message.chat_id == chat_id,
        ~Message.id.in_(subquery)
    ).all()
    for msg in messages:
        db.add(MessageRead(message_id=msg.id, user_id=user_id))
    db.commit()

def get_unread_count(db: Session, chat_id: int, user_id: int) -> int:
    subquery = db.query(MessageRead.message_id).filter(MessageRead.user_id == user_id).subquery()
    return db.query(Message).filter(
        Message.chat_id == chat_id,
        ~Message.id.in_(subquery)
    ).count()

def create_message_read_for_sender(db: Session, message_id: int, sender_id: int):
    db.add(MessageRead(message_id=message_id, user_id=sender_id))
    db.commit()

# ---------- API ЭНДПОИНТЫ ----------

@app.get("/")
async def serve_index():
    return FileResponse("static/index.html")

@app.post("/api/register", response_model=Token)
def register(user_data: UserCreate, db: Session = Depends(get_db)):
    if db.query(User).filter(User.username == user_data.username).first():
        raise HTTPException(status_code=400, detail="Имя уже занято")
    if db.query(User).filter(User.email == user_data.email).first():
        raise HTTPException(status_code=400, detail="Email уже используется")
    new_user = User(
        username=user_data.username,
        password_hash=user_data.password,
        email=user_data.email,
        display_name=user_data.display_name or user_data.username
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    token = f"jwt-token-for-{new_user.username}"
    return {"access_token": token, "token_type": "bearer", "user_id": new_user.id}

@app.post("/api/token", response_model=Token)
def login(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == form_data.username).first()
    if not user or user.password_hash != form_data.password:
        raise HTTPException(status_code=400, detail="Неверное имя или пароль")
    token = f"jwt-token-for-{user.username}"
    return {"access_token": token, "token_type": "bearer", "user_id": user.id}

@app.get("/api/users/me", response_model=UserOut)
def get_me(current_user: User = Depends(get_current_user)):
    return {
        "id": current_user.id,
        "username": current_user.username,
        "display_name": current_user.display_name,
        "avatar_path": current_user.avatar_path,
        "status": current_user.status
    }

@app.get("/api/users/search")
def search_users(
    q: str,
    exclude_self: bool = True,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    if not q:
        return []
    query = db.query(User).filter(
        (User.username.ilike(f"%{q}%")) | (User.display_name.ilike(f"%{q}%"))
    )
    if exclude_self:
        query = query.filter(User.id != current_user.id)
    users = query.limit(20).all()
    return [
        {
            "id": u.id,
            "username": u.username,
            "display_name": u.display_name,
            "avatar_path": u.avatar_path
        } for u in users
    ]

@app.post("/api/upload_avatar")
async def upload_avatar(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    os.makedirs(AVATAR_DIR, exist_ok=True)
    ext = os.path.splitext(file.filename)[1]
    filename = f"avatar_{current_user.id}_{datetime.now().strftime('%Y%m%d%H%M%S')}{ext}"
    file_path = os.path.join(AVATAR_DIR, filename)
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
    current_user.avatar_path = f"/static/avatars/{filename}"
    db.commit()
    return {"avatar_path": f"{current_user.avatar_path}?t={int(datetime.now().timestamp())}"}

@app.post("/api/chats/direct/{user_id}")
def get_or_create_direct_chat(
    user_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    other = db.query(User).filter(User.id == user_id).first()
    if not other:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    sub = db.query(ChatMember.chat_id).filter(ChatMember.user_id == current_user.id).subquery()
    chats = db.query(Chat).filter(Chat.id.in_(sub)).filter(Chat.is_group == False).all()
    for chat in chats:
        members = db.query(ChatMember).filter(ChatMember.chat_id == chat.id).all()
        if len(members) == 2 and any(m.user_id == user_id for m in members):
            return {"chat_id": chat.id}
    new_chat = Chat(name=None, is_group=False, creator_id=None)
    db.add(new_chat)
    db.commit()
    db.refresh(new_chat)
    db.add(ChatMember(chat_id=new_chat.id, user_id=current_user.id))
    db.add(ChatMember(chat_id=new_chat.id, user_id=user_id))
    db.commit()
    return {"chat_id": new_chat.id}

@app.post("/api/chats/group")
def create_group_chat(
    data: CreateGroupChat,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    if len(data.user_ids) < 2:
        raise HTTPException(status_code=400, detail="Нужно минимум 2 участника")
    if current_user.id not in data.user_ids:
        data.user_ids.append(current_user.id)
    users = db.query(User).filter(User.id.in_(data.user_ids)).all()
    if len(users) != len(set(data.user_ids)):
        raise HTTPException(status_code=404, detail="Один из пользователей не найден")
    new_chat = Chat(name=data.name, is_group=True, creator_id=current_user.id)
    db.add(new_chat)
    db.commit()
    db.refresh(new_chat)
    for uid in set(data.user_ids):
        db.add(ChatMember(chat_id=new_chat.id, user_id=uid))
    db.commit()
    return {"chat_id": new_chat.id}

@app.get("/api/chats/{chat_id}/info")
def get_chat_info(
    chat_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    chat = db.query(Chat).filter(Chat.id == chat_id).first()
    if not chat:
        raise HTTPException(status_code=404, detail="Чат не найден")
    membership = db.query(ChatMember).filter(ChatMember.chat_id == chat_id, ChatMember.user_id == current_user.id).first()
    if not membership:
        raise HTTPException(status_code=403, detail="Нет доступа")
    members = db.query(ChatMember).filter(ChatMember.chat_id == chat_id).all()
    user_ids = [m.user_id for m in members]
    users = db.query(User).filter(User.id.in_(user_ids)).all()
    return {
        "id": chat.id,
        "name": chat.name,
        "is_group": chat.is_group,
        "creator_id": chat.creator_id,
        "is_creator": chat.creator_id == current_user.id,
        "members": [
            {"id": u.id, "username": u.username, "display_name": u.display_name, "avatar_path": u.avatar_path}
            for u in users
        ]
    }

@app.post("/api/chats/{chat_id}/add")
def add_user_to_chat(
    chat_id: int,
    data: AddUserToChat,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    chat = db.query(Chat).filter(Chat.id == chat_id).first()
    if not chat or not chat.is_group:
        raise HTTPException(status_code=400, detail="Чат не является групповым")
    if chat.creator_id != current_user.id:
        raise HTTPException(status_code=403, detail="Только создатель может добавлять участников")
    user = db.query(User).filter(User.id == data.user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    if db.query(ChatMember).filter(ChatMember.chat_id == chat_id, ChatMember.user_id == data.user_id).first():
        raise HTTPException(status_code=400, detail="Уже в чате")
    db.add(ChatMember(chat_id=chat_id, user_id=data.user_id))
    db.commit()
    return {"status": "ok"}

@app.delete("/api/chats/{chat_id}/remove/{user_id}")
def remove_user_from_chat(
    chat_id: int,
    user_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    chat = db.query(Chat).filter(Chat.id == chat_id).first()
    if not chat or not chat.is_group:
        raise HTTPException(status_code=400, detail="Чат не является групповым")
    if chat.creator_id != current_user.id:
        raise HTTPException(status_code=403, detail="Только создатель может удалять участников")
    if user_id == chat.creator_id:
        raise HTTPException(status_code=400, detail="Нельзя удалить создателя")
    member = db.query(ChatMember).filter(ChatMember.chat_id == chat_id, ChatMember.user_id == user_id).first()
    if not member:
        raise HTTPException(status_code=404, detail="Участник не найден")
    db.delete(member)
    db.commit()
    return {"status": "ok"}

@app.get("/api/chats", response_model=List[ChatOut])
def get_chats(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    chat_ids = db.query(ChatMember.chat_id).filter(ChatMember.user_id == current_user.id).subquery()
    chats = db.query(Chat).filter(Chat.id.in_(chat_ids)).all()
    result = []
    for chat in chats:
        last_msg = db.query(Message).filter(Message.chat_id == chat.id).order_by(Message.created_at.desc()).first()
        if not chat.is_group and not chat.name:
            members = db.query(ChatMember).filter(ChatMember.chat_id == chat.id).all()
            other = [m for m in members if m.user_id != current_user.id]
            if other:
                other_user = db.query(User).filter(User.id == other[0].user_id).first()
                chat_name = other_user.display_name if other_user else "Unknown"
            else:
                chat_name = "Личный чат"
        else:
            chat_name = chat.name or f"Группа #{chat.id}"
        unread = get_unread_count(db, chat.id, current_user.id)
        result.append(ChatOut(
            id=chat.id,
            name=chat_name,
            is_group=chat.is_group,
            is_creator=(chat.creator_id == current_user.id),
            last_message=last_msg.text_content if last_msg else None,
            last_message_time=last_msg.created_at if last_msg else None,
            unread_count=unread
        ))
    return result

@app.get("/api/messages/{chat_id}", response_model=List[MessageOut])
def get_messages(chat_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    membership = db.query(ChatMember).filter(ChatMember.chat_id == chat_id, ChatMember.user_id == current_user.id).first()
    if not membership:
        raise HTTPException(status_code=403, detail="Нет доступа")
    messages = db.query(Message).filter(Message.chat_id == chat_id).order_by(Message.created_at).all()
    read_ids = {r.message_id for r in db.query(MessageRead).filter(MessageRead.user_id == current_user.id).all()}
    result = []
    for msg in messages:
        sender = db.query(User).filter(User.id == msg.sender_id).first()
        result.append(MessageOut(
            id=msg.id,
            sender_id=msg.sender_id,
            sender_username=sender.username if sender else "Unknown",
            text_content=msg.text_content,
            message_type=msg.message_type,
            file_path=msg.file_path,
            created_at=msg.created_at,
            is_read=(msg.id in read_ids)
        ))
    return result

@app.post("/api/chats/{chat_id}/read")
def mark_chat_read(
    chat_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    membership = db.query(ChatMember).filter(ChatMember.chat_id == chat_id, ChatMember.user_id == current_user.id).first()
    if not membership:
        raise HTTPException(status_code=403, detail="Нет доступа")
    mark_messages_as_read(db, chat_id, current_user.id)
    return {"status": "ok"}

@app.post("/api/upload")
async def upload_file(
    chat_id: int = Form(...),
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    membership = db.query(ChatMember).filter(ChatMember.chat_id == chat_id, ChatMember.user_id == current_user.id).first()
    if not membership:
        raise HTTPException(status_code=403, detail="Нет доступа")
    ext = os.path.splitext(file.filename)[1]
    filename = f"{datetime.now().strftime('%Y%m%d%H%M%S')}_{current_user.id}{ext}"
    file_path = os.path.join(UPLOAD_DIR, filename)
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
    msg_type = "audio" if ext.lower() in ['.wav', '.mp3', '.ogg', '.aac'] else "image" if ext.lower() in ['.jpg', '.jpeg', '.png', '.gif', '.webp'] else "file"
    new_msg = Message(
        chat_id=chat_id,
        sender_id=current_user.id,
        text_content=file.filename,
        message_type=msg_type,
        file_path=f"/{UPLOAD_DIR}/{filename}",
        created_at=datetime.utcnow()
    )
    db.add(new_msg)
    db.commit()
    db.refresh(new_msg)
    create_message_read_for_sender(db, new_msg.id, current_user.id)
    payload = {
        "id": new_msg.id,
        "chat_id": chat_id,
        "sender_id": current_user.id,
        "sender_username": current_user.username,
        "message_type": msg_type,
        "file_path": new_msg.file_path,
        "text_content": new_msg.text_content,
        "created_at": new_msg.created_at.isoformat()
    }
    members = db.query(ChatMember).filter(ChatMember.chat_id == chat_id).all()
    for m in members:
        await manager.send_to_user(m.user_id, payload)
    return {"status": "ok", "path": new_msg.file_path}

# ---------- WebSocket ----------
class ConnectionManager:
    def __init__(self):
        self.active_connections = {}

    async def connect(self, user_id: int, websocket: WebSocket):
        await websocket.accept()
        if user_id not in self.active_connections:
            self.active_connections[user_id] = []
        self.active_connections[user_id].append(websocket)

    def disconnect(self, user_id: int, websocket: WebSocket):
        if user_id in self.active_connections:
            if websocket in self.active_connections[user_id]:
                self.active_connections[user_id].remove(websocket)
            if not self.active_connections[user_id]:
                del self.active_connections[user_id]

    async def send_to_user(self, user_id: int, message: dict):
        if user_id in self.active_connections:
            for ws in self.active_connections[user_id]:
                await ws.send_json(message)

manager = ConnectionManager()

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, token: str = None):
    if not token or not token.startswith("jwt-token-for-"):
        await websocket.close(code=1008)
        return
    username = token.replace("jwt-token-for-", "")
    db = SessionLocal()
    user = db.query(User).filter(User.username == username).first()
    if not user:
        await websocket.close(code=1008)
        db.close()
        return
    await manager.connect(user.id, websocket)
    try:
        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type")
            chat_id = data.get("chat_id")
            if msg_type == "text_message":
                text = data.get("text_content", "").strip()
                if not text or not chat_id:
                    continue
                membership = db.query(ChatMember).filter(ChatMember.chat_id == chat_id, ChatMember.user_id == user.id).first()
                if not membership:
                    continue
                new_msg = Message(
                    chat_id=chat_id,
                    sender_id=user.id,
                    text_content=text,
                    message_type="text",
                    created_at=datetime.utcnow()
                )
                db.add(new_msg)
                db.commit()
                db.refresh(new_msg)
                create_message_read_for_sender(db, new_msg.id, user.id)
                payload = {
                    "id": new_msg.id,
                    "chat_id": chat_id,
                    "sender_id": user.id,
                    "sender_username": user.username,
                    "message_type": "text",
                    "file_path": None,
                    "text_content": text,
                    "created_at": new_msg.created_at.isoformat()
                }
                members = db.query(ChatMember).filter(ChatMember.chat_id == chat_id).all()
                for m in members:
                    await manager.send_to_user(m.user_id, payload)
    except WebSocketDisconnect:
        manager.disconnect(user.id, websocket)
    finally:
        db.close()

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)