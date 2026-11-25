import mongoose, { Schema, Document } from 'mongoose';

export type MessageType = 'text' | 'file' | 'document_request' | 'form_request' | 'form_response' | 'system';

/** Snapshot of the message being replied to (denormalised for cheap rendering) */
export interface IReplyTo {
  messageId: mongoose.Types.ObjectId;
  senderName: string;
  preview: string;
}

export interface IReaction {
  userId: mongoose.Types.ObjectId;
  emoji: string;
}

export interface IMessage extends Document {
  conversationId: mongoose.Types.ObjectId;
  senderId: mongoose.Types.ObjectId;
  senderName: string;
  type: MessageType;
  text?: string;
  /** Absolute Cloudinary URL (legacy records may hold a relative `/uploads/…` path) */
  fileUrl?: string;
  fileName?: string;
  /** Cloudinary public id — absent on records created before the Cloudinary migration */
  filePublicId?: string;
  fileResourceType?: 'image' | 'video' | 'raw';
  /**
   * Type-specific payload:
   * - document_request: { items: [{ requestId, type, label?, note?, status }] }
   * - form_request:     { title, fields: [{ id, label, required? }], answered?, responseId? }
   * - form_response:    { formMessageId, title, answers: [{ id, label, value }] }
   * - file (voice):     { voice: true, duration?: number }
   */
  meta?: Record<string, unknown>;
  replyTo?: IReplyTo;
  reactions: IReaction[];
  editedAt?: Date;
  /** Pinned to the top of the thread for everyone in it */
  pinnedAt?: Date;
  pinnedBy?: mongoose.Types.ObjectId;
  /** Private bookmarks — never sent to anyone but the holder */
  starredBy: mongoose.Types.ObjectId[];
  /** hidden only for these users ("delete for me") */
  deletedFor: mongoose.Types.ObjectId[];
  /** tombstone visible to everyone ("delete for everyone") */
  deletedForEveryone: boolean;
  readBy: mongoose.Types.ObjectId[];
  createdAt: Date;
}

const ReplyToSchema = new Schema<IReplyTo>({
  messageId:  { type: Schema.Types.ObjectId, ref: 'Message', required: true },
  senderName: { type: String, required: true },
  preview:    { type: String, required: true },
}, { _id: false });

const MessageSchema = new Schema<IMessage>({
  conversationId: { type: Schema.Types.ObjectId, ref: 'Conversation', required: true },
  senderId:       { type: Schema.Types.ObjectId, ref: 'User', required: true },
  senderName:     { type: String, required: true },
  type:           { type: String, enum: ['text','file','document_request','form_request','form_response','system'], default: 'text' },
  text:           String,
  fileUrl:        String,
  fileName:       String,
  filePublicId:   String,
  fileResourceType: { type: String, enum: ['image', 'video', 'raw'] },
  meta:           { type: Schema.Types.Mixed },
  replyTo:        { type: ReplyToSchema },
  reactions:      { type: [{ userId: { type: Schema.Types.ObjectId, ref: 'User', required: true }, emoji: { type: String, required: true }, _id: false }], default: [] },
  editedAt:       Date,
  pinnedAt:       Date,
  pinnedBy:       { type: Schema.Types.ObjectId, ref: 'User' },
  starredBy:      [{ type: Schema.Types.ObjectId, ref: 'User' }],
  deletedFor:     [{ type: Schema.Types.ObjectId, ref: 'User' }],
  deletedForEveryone: { type: Boolean, default: false },
  readBy:         [{ type: Schema.Types.ObjectId, ref: 'User' }],
}, { timestamps: true });

MessageSchema.index({ conversationId: 1, createdAt: 1 });
MessageSchema.index({ conversationId: 1, pinnedAt: -1 }, { partialFilterExpression: { pinnedAt: { $exists: true } } });
MessageSchema.index({ starredBy: 1, createdAt: -1 });

export default mongoose.model<IMessage>('Message', MessageSchema);
