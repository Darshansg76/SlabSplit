from functools import lru_cache
import os
from fastapi import FastAPI
from pydantic import BaseModel, Field
from sentence_transformers import SentenceTransformer

app = FastAPI(title='SlabSplit embedding service')

class Input(BaseModel):
    text: str = Field(min_length=1, max_length=10000)

@lru_cache
def model():
    return SentenceTransformer(os.getenv('MODEL_NAME', 'sentence-transformers/all-MiniLM-L6-v2'))

@app.post('/embed')
def embed(input: Input):
    vector = model().encode(input.text, normalize_embeddings=True)
    return {'embedding': vector.tolist()}
