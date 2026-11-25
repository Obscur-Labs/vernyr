import mongoose, { Schema, Document } from 'mongoose';

export interface IConversation extends Document {
  participants: mongoose.Types.ObjectId[];
  studentId?: mongoose.Types.ObjectId;
  /** Closed conversations keep their history but reject new messages
      (e.g. after the student is reassigned to another counsellor). */
  archived: boolean;
  lastMessage?: { text: string; senderId: mongoose.Types.ObjectId; createdAt: Date };
  updatedAt: Date;
}

const ConversationSchema = new Schema<IConversation>({
  participants: [{ type: Schema.Types.ObjectId, ref: 'User' }],
  studentId:    { type: Schema.Types.ObjectId, ref: 'Student' },
  archived:     { type: Boolean, default: false },
  lastMessage: {
    text:      String,
    senderId:  { type: Schema.Types.ObjectId, ref: 'User' },
    createdAt: Date,
  },
}, { timestamps: true });

export default mongoose.model<IConversation>('Conversation', ConversationSchema);
