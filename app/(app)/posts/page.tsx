import PageHeader from "@/components/PageHeader";
import PostStream from "@/components/PostStream";
import { getPosts } from "@/lib/data";

export const metadata = { title: "Posts — Alliance Social" };

export default async function PostsPage() {
  const posts = await getPosts();
  return (
    <div>
      <PageHeader
        title="Posts"
        description="Every post pulled from your connected Facebook, Instagram, and TikTok accounts. Use the filters to slice by platform, date range, or property — tap a row for full analytics."
      />
      <PostStream posts={posts} pageSize={12} />
    </div>
  );
}
