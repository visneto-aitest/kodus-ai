"use client";

import { Extension } from "@tiptap/core";

export interface MentionTriggerOptions {
    /**
     * Called when the user types `@`. Return `true` to consume the keystroke
     * (the consumer is opening a mention popup and the `@` should not be
     * inserted as text). Return `false` to let Tiptap insert the literal `@`,
     * which is what we want when there are no mention suggestions to show
     * — otherwise the user cannot type things like `@file:owner/repo/path`
     * inside a kody rule description.
     */
    onTrigger: (pos: number) => boolean | void;
}

export const MentionTrigger = Extension.create<MentionTriggerOptions>({
    name: "mentionTrigger",

    addOptions() {
        return {
            onTrigger: () => false,
        };
    },

    addKeyboardShortcuts() {
        return {
            "@": ({ editor }) => {
                const { state } = editor;
                const { selection } = state;
                const pos = selection.$from.pos;
                const consumed = this.options.onTrigger(pos);
                return consumed === true;
            },
        };
    },
});
