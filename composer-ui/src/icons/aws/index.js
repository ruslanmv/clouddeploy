import S3Icon from "./S3.jsx";
import LambdaIcon from "./Lambda.jsx";

export const AwsIcons = {
  "aws.s3": S3Icon,
  "aws.lambda": LambdaIcon,
};

export function getAwsIcon(type) {
  return AwsIcons[type] || null;
}
