const mongoose = require("mongoose");

// Atomic sequence numbers (e.g. invoice numbers).
const counterSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  seq: { type: Number, default: 0 },
});

counterSchema.statics.next = async function next(name) {
  const counter = await this.findOneAndUpdate({ _id: name }, { $inc: { seq: 1 } }, { returnDocument: "after", upsert: true });
  return counter.seq;
};

module.exports = mongoose.model("Counter", counterSchema);
