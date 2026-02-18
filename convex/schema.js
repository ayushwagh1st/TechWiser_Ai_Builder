import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

export default defineSchema({
    users: defineTable({
        name: v.string(),
        email: v.string(),
        picture: v.string(),
        uid: v.string()
    }),
    workspace: defineTable({
        messages: v.any(),
        fileData: v.optional(v.any()),
        userToken: v.optional(v.string())
    }).index('by_userToken', ['userToken'])
});