## How to use the archetype?

```shell
mvn archetype:generate \
  -DarchetypeGroupId=com.ryan.persimmon \
  -DarchetypeArtifactId=persimmon-scaffold-archetype \
  -DarchetypeVersion=0.0.1 \
  -DgroupId=com.acme.persimmon \
  -DartifactId=persimmon-tenantprovisioning-demo \
  -Dversion=0.0.1 \
  -Dpackage=com.acme.persimmon.demo.tenantprovisioning \
  -DinteractiveMode=false
```