import { useEffect, useRef } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { AppBskyFeedDefs } from "@atproto/api";
import { FlashList } from "@shopify/flash-list";
import { useQuery } from "@tanstack/react-query";

import { FeedPost } from "../../../../components/feed-post";
import { Post } from "../../../../components/post";
import { useAuthedAgent } from "../../../../lib/agent";
import { useTabPressScroll } from "../../../../lib/hooks";
import { assert } from "../../../../lib/utils/assert";
import { useUserRefresh } from "../../../../lib/utils/query";

type Posts = {
  post: AppBskyFeedDefs.PostView;
  primary: boolean;
  hasParent: boolean;
  hasReply: boolean;
};

export default function PostPage() {
  const { handle, id } = useLocalSearchParams() as {
    id: string;
    handle: string;
  };
  const agent = useAuthedAgent();
  const ref = useRef<FlashList<any>>(null);
  const hasScrolled = useRef(false);

  const thread = useQuery(["profile", handle, "post", id], async () => {
    let did = handle;
    if (!did.startsWith("did:")) {
      const { data } = await agent.resolveHandle({ handle });
      did = data.did;
    }
    const uri = `at://${did}/app.bsky.feed.post/${id}`;
    const postThread = await agent.getPostThread({ uri });

    const thread = postThread.data.thread;

    if (!AppBskyFeedDefs.isThreadViewPost(thread))
      throw Error("Post not found");
    assert(AppBskyFeedDefs.validateThreadViewPost(thread));

    const posts: Posts[] = [];

    // see if has parents
    const ancestors: Posts[] = [];

    let ancestor = thread;
    while (ancestor.parent) {
      if (!AppBskyFeedDefs.isThreadViewPost(ancestor.parent)) break;
      assert(AppBskyFeedDefs.validateThreadViewPost(ancestor.parent));

      ancestors.push({
        post: ancestor.parent.post,
        primary: false,
        hasParent: false,
        hasReply: true,
      });

      ancestor = ancestor.parent;
    }

    const index = ancestors.length;
    ancestors.reverse();
    posts.push(...ancestors);

    posts.push({
      post: thread.post,
      primary: true,
      hasParent: !!thread.parent,
      hasReply: false,
    });

    if (thread.replies) {
      for (const reply of thread.replies) {
        if (!AppBskyFeedDefs.isThreadViewPost(reply)) continue;
        assert(AppBskyFeedDefs.validateThreadViewPost(reply));

        posts.push({
          post: reply.post,
          primary: false,
          hasParent: false,
          hasReply: !!reply.replies?.[0],
        });

        if (reply.replies && reply.replies[0]) {
          let child;
          child = reply.replies[0];
          while (child) {
            if (!AppBskyFeedDefs.isThreadViewPost(child)) break;
            assert(AppBskyFeedDefs.validateThreadViewPost(child));

            posts.push({
              post: child.post,
              primary: false,
              hasParent: false,
              hasReply: !!child.replies?.[0],
            });

            child = child.replies?.[0];
          }
        }
      }
    }

    return { posts, index };
  });

  const { refreshing, handleRefresh } = useUserRefresh(thread.refetch);

  // hacky but needed until https://github.com/Shopify/flash-list/issues/671 is fixed
  useEffect(() => {
    if (thread.isSuccess && !hasScrolled.current) {
      const index = thread.data.index;
      hasScrolled.current = true;
      setTimeout(() => {
        ref.current?.scrollToIndex({
          animated: true,
          index,
        });
      }, 500);
    }
  }, [thread.isSuccess]);

  useTabPressScroll(ref);

  switch (thread.status) {
    case "loading":
      return (
        <View className="flex-1 items-center justify-center">
          <Stack.Screen options={{ headerTitle: "Post" }} />
          <ActivityIndicator />
        </View>
      );
    case "error":
      return (
        <View className="flex-1 items-center justify-center p-4">
          <Stack.Screen options={{ headerTitle: "Post" }} />
          <Text className="text-center text-xl">
            {(thread.error as Error).message || "An error occurred"}
          </Text>
        </View>
      );
    case "success":
      return (
        <>
          <Stack.Screen options={{ headerTitle: "Post" }} />
          <FlashList
            ref={ref}
            data={thread.data.posts}
            estimatedItemSize={91}
            onRefresh={handleRefresh}
            refreshing={refreshing}
            ListFooterComponent={<View className="h-20" />}
            getItemType={(item) => (item.primary ? "big" : "small")}
            renderItem={({ item, index }) =>
              item.primary ? (
                <Post post={item.post} hasParent={item.hasParent} />
              ) : (
                <FeedPost
                  item={{ post: item.post }}
                  hasReply={item.hasReply}
                  isReply={thread.data.posts[index - 1]?.hasReply}
                />
              )
            }
          />
        </>
      );
  }
}
