---
description: PostgreSQL table template + partial unique index (soft delete).
applyTo: "src/main/java/**/po/*PO.java"
---

## PO class constraints
- PO classes MUST extend `BasePO`.
- PO classes MUST use `@TableName("<table-name>")` annotation to specify the database table name.
- PO classes MUST use Lombok `@Getter` and `@Setter` annotations for boilerplate code reduction.
- PO class name suffix is `PO`.

```java
import com.baomidou.mybatisplus.annotation.TableName;
import com.ryan.persimmon.infra.common.database.BasePO;
import lombok.Getter;
import lombok.Setter;

@TableName("<table-name>")
@Getter
@Setter
public class <po-class-name> extends BasePO {
  // Business fields
}
```