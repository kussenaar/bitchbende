export function Beaver({ className = '' }: { className?: string }) {
  return (
    <img
      className={`beaver ${className}`}
      src={`${import.meta.env.BASE_URL}image-removebg-preview%20(2).png`}
      width={500}
      height={500}
      alt=""
      aria-hidden="true"
      draggable={false}
    />
  )
}
