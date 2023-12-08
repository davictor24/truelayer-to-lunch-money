import mongoose from 'mongoose';
import { ConnectionSchema } from '../schemas/connection';

const ConnectionModel = mongoose.model('Connection', ConnectionSchema);
export default ConnectionModel;
