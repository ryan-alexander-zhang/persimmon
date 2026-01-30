package com.ryan.persimmon.infra.repository.biz.mapper;

import static org.junit.jupiter.api.Assertions.*;

import com.baomidou.mybatisplus.test.autoconfigure.MybatisPlusTest;
import com.ryan.persimmon.infra.common.database.UuidTypeHandler;
import com.ryan.persimmon.infra.repository.biz.po.DemoBizPO;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.MethodOrderer.OrderAnnotation;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.mybatis.spring.annotation.MapperScan;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase.Replace;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Import;
import org.springframework.test.annotation.Rollback;

@MybatisPlusTest(
    properties = {
      "spring.test.database.replace=none",
      "spring.datasource.url=jdbc:postgresql://localhost:5432/persimmon_scaffold",
      "spring.datasource.username=postgres",
      "spring.datasource.password=postgres",
      "spring.datasource.driver-class-name=org.postgresql.Driver",
      "spring.sql.init.mode=always",
      "spring.sql.init.schema-locations=classpath:schema.sql",
    })
@AutoConfigureTestDatabase(replace = Replace.NONE)
@Import({DemoBizMapperTest.MapperConfig.class, UuidTypeHandler.class})
@TestMethodOrder(OrderAnnotation.class)
class DemoBizMapperTest {
  private final String name = "test-01";
  private final UUID id = UUID.fromString("019c0e02-a181-786f-8d5b-11c4de115f92");
  @Autowired private DemoBizMapper demoBizMapper;

  @Test
  @Order(1)
  @Rollback(value = false)
  void testInsert() {
    DemoBizPO demoBizPO = new DemoBizPO();
    demoBizPO.setName(name);
    demoBizPO.setStatus("CREATING");
    demoBizPO.setId(id);
    int insert = demoBizMapper.insert(demoBizPO);
    assertEquals(1, insert);
  }

  @Test
  @Order(2)
  void testSelect() {
    List<DemoBizPO> list = demoBizMapper.selectList(null);
    assertNotNull(list);
    assertFalse(list.isEmpty());
    assertEquals(1, list.size());
    assertEquals(name, list.getFirst().getName());
  }

  @Test
  @Order(3)
  @Rollback(value = false)
  void testDelete() {
    int i = demoBizMapper.deleteById(id);
    assertEquals(1, i);
  }

  @Configuration
  @MapperScan("com.ryan.persimmon.infra.repository.biz.mapper")
  static class MapperConfig {}
}
