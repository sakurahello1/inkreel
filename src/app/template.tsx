/** 每次换页重新挂载：内容从下面浮上来一小段，页面切换不再是硬切 */
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="anim-in flex min-h-0 flex-1 flex-col">{children}</div>;
}
