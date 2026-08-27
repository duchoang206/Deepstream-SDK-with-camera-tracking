import os
import chromadb
from chromadb.utils import embedding_functions
from langchain_text_splitters import RecursiveCharacterTextSplitter
from pypdf import PdfReader

class RAGManager:
    def __init__(self, db_path="./data/chroma", collection_name="vms_docs"):
        self.db_path = db_path
        # Sử dụng model nhúng nhẹ và miễn phí
        self.embedding_function = embedding_functions.SentenceTransformerEmbeddingFunction(model_name="all-MiniLM-L6-v2")
        
        os.makedirs(self.db_path, exist_ok=True)
        self.client = chromadb.PersistentClient(path=self.db_path)
        
        self.collection = self.client.get_or_create_collection(
            name=collection_name,
            embedding_function=self.embedding_function
        )
        
    def initialize_with_pdf(self, pdf_path):
        if self.collection.count() > 0:
            print(f"[RAG] Database đã có {self.collection.count()} chunks. Bỏ qua bước trích xuất PDF.")
            return

        if not os.path.exists(pdf_path):
            print(f"[RAG] Cảnh báo: Không tìm thấy file PDF tại {pdf_path}")
            return

        print(f"[RAG] Đang đọc và vector hoá tài liệu PDF: {pdf_path}...")
        
        reader = PdfReader(pdf_path)
        text = ""
        for page in reader.pages:
            page_text = page.extract_text()
            if page_text:
                text += page_text + "\n"
                
        text_splitter = RecursiveCharacterTextSplitter(
            chunk_size=1000,
            chunk_overlap=200,
            length_function=len
        )
        chunks = text_splitter.split_text(text)
        
        ids = [f"chunk_{i}" for i in range(len(chunks))]
        self.collection.add(
            documents=chunks,
            ids=ids
        )
        print(f"[RAG] Đã vector hoá và lưu {len(chunks)} chunks vào ChromaDB.")

    def query_rag(self, query: str, top_k: int = 2):
        if self.collection.count() == 0:
            return "Không có dữ liệu tài liệu kỹ thuật nào được tìm thấy."
            
        results = self.collection.query(
            query_texts=[query],
            n_results=top_k
        )
        
        if not results['documents'] or len(results['documents'][0]) == 0:
            return "Không tìm thấy thông tin tương ứng trong tài liệu kỹ thuật."
            
        context_chunks = results['documents'][0]
        context = "\n\n".join(context_chunks)
        return context

# Khởi tạo instance duy nhất
db_path = os.path.join(os.path.dirname(__file__), "..", "data", "chroma")
rag_engine = RAGManager(db_path=db_path)
