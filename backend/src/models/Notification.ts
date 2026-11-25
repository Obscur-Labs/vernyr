import mongoose, { Schema, Document } from 'mongoose';

export interface INotification extends Document {
  userId: mongoose.Types.ObjectId;
  type: string;
  title: string;
  body: string;
  link?: string;
  read: boolean;
  createdAt: Date;
}

const NotificationSchema = new Schema<INotification>({
  userId:  { type: Schema.Types.ObjectId, ref: 'User', required: true },
  type:    { type: String, required: true },
  title:   { type: String, required: true },
  body:    { type: String, required: true },
  link:    String,
  read:    { type: Boolean, default: false },
}, { timestamps: true });

export default mongoose.model<INotification>('Notification', NotificationSchema);
