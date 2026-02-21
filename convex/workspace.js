import { v } from 'convex/values';
import { mutation, query } from './_generated/server';

export const CreateWorkspace = mutation({
    args: {
        messages: v.any(),
        userToken: v.optional(v.string())
    },
    handler: async (ctx, args) => {
        const workspaceId = await ctx.db.insert('workspace', {
            messages: args.messages,
            userToken: args.userToken
        });
        return workspaceId;
    }
})

export const GetAllWorkspaces = query({
    args: {
        userToken: v.optional(v.string())
    },
    handler: async (ctx, args) => {
        if (!args.userToken) return [];
        const result = await ctx.db.query('workspace')
            .withIndex('by_userToken', q => q.eq('userToken', args.userToken))
            .collect();
        return result;
    }
})

export const GetWorkspace = query({
    args: {
        workspaceId: v.id('workspace')
    },
    handler: async (ctx, args) => {
        const result = await ctx.db.get(args.workspaceId);
        return result;
    }
})

export const UpdateWorkspace = mutation({
    args: {
        workspaceId: v.id('workspace'),
        messages: v.any(),
    },
    handler: async (ctx, args) => {
        const existing = await ctx.db.get(args.workspaceId);
        if (!existing) return null;

        const result = await ctx.db.patch(args.workspaceId, {
            messages: args.messages
        });
        return result;
    }
})

export const UpdateFiles = mutation({
    args: {
        workspaceId: v.id('workspace'),
        files: v.any(),
    },
    handler: async (ctx, args) => {
        const existing = await ctx.db.get(args.workspaceId);
        if (!existing) return null;

        const result = await ctx.db.patch(args.workspaceId, {
            fileData: args.files
        });
        return result;
    }
})

export const DeleteWorkspace = mutation({
    args: {
        workspaceId: v.id('workspace'),
    },
    handler: async (ctx, args) => {
        try {
            await ctx.db.delete(args.workspaceId);
            return { success: true };
        } catch (e) {
            return { success: false, error: e.message };
        }
    }
})

