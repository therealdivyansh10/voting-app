import express from "express";
import cors from "cors";
import http from "http";
import { Server } from "socket.io";
import Redis from "ioredis";
import "dotenv/config";

const app = express();
app.use(cors());

const redis = new Redis(process.env.REDIS_CONNECTION_STRING);
const subRedis = new Redis(process.env.REDIS_CONNECTION_STRING);

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: ["http://localhost:3000"],
    methods: ["GET", "POST"],
    credentials: true,
  },
});

subRedis.on("message", (channel, message) => {
  io.to(channel).emit("room-update", message);
})

subRedis.on("error", (err)=> {
  console.log("Redis subscription error");
})

io.on("connection", async (socket) => {
  const { id } = socket;
  console.log(`User connected: ${id}`);

  socket.on("join-room", async (room: string) => {
    console.log("user joined room:", room);

    const subscribedRooms = await redis.smembers("subscribed-rooms");

    await socket.join(room);
    await redis.sadd(`rooms:${id}`, room);
    await redis.hincrby("room-connections", room, 1);

    if (!subscribedRooms.includes(room)) {
      subRedis.subscribe(room, async (error) => {
        if (error) {
          console.log("Failed to subscribe:", error);
        } else {
          await redis.sadd("subscribed-rooms", room);
          console.log("subscribed to room:", room);
        }
      });
    }
  });

  socket.on("disconnect", async() => {
    const {id} = socket;
    const joinedRooms = await redis.smembers(`rooms: ${id}`);
    await redis.del(`rooms: ${id}`);

    joinedRooms.forEach(async (room) => {
      const remainingConnections = await redis.hincrby(
        `room-connections`,
        room,
        -1
      )

      if(remainingConnections<=0){
        await redis.hdel(`room-connections`, room);
        subRedis.unsubscribe(room, async (err)=> {
          console.log("Failed to unsubscribe", err);
        })
      }else{
        await redis.srem("subscribed-rooms",room);
        console.log("unsubscribed-room")
      }
    })

  })


});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
